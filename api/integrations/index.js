"use strict"

/**
 * @module integrations
 *
 * Registry of premium integration modules and the helper
 * that unions a Pro user's connected-integration tools
 * into an MCP server, alongside the core kaisho tools.
 *
 * Each module exports ``KIND``, ``validate``, ``tools()``
 * and ``dispatch(tool, args, credentials)``. Tools are
 * namespaced (``linear_*`` / ``github_*`` / …) so they
 * never collide with the core tool surface.
 */

const linear = require("./linear")
const github = require("./github")
const slack = require("./slack")
const google = require("./google")
const {
  listIntegrations, getIntegration, saveIntegration,
} = require("./store")

const { logger } = require("../logger")

const MODULES = {
  [linear.KIND]: linear,
  [github.KIND]: github,
  [slack.KIND]: slack,
  [google.KIND]: google,
}

// Refresh an OAuth token that is within this window of
// expiry before using it.
const REFRESH_SKEW_MS = 60_000

function jsonResult(payload) {
  return {
    content: [{
      type: "text",
      text: JSON.stringify(payload, null, 2),
    }],
  }
}

function errorResult(message) {
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  }
}

/**
 * Return usable credentials for an integration, refreshing
 * an expiring OAuth token first (and persisting the new
 * one). Modules without ``refresh`` (Linear/GitHub/Slack)
 * just return their stored credentials unchanged.
 *
 * @param {string} userId
 * @param {string} kind
 * @param {object} mod - Integration module.
 * @param {object} integ - { credentials, scopes, expiresAt }.
 * @returns {Promise<object>} Credentials to dispatch with.
 */
async function freshCredentials(userId, kind, mod, integ) {
  if (!mod.refresh || !integ.expiresAt) {
    return integ.credentials
  }
  const expMs = new Date(integ.expiresAt).getTime()
  if (Date.now() < expMs - REFRESH_SKEW_MS) {
    return integ.credentials
  }
  const r = await mod.refresh(integ.credentials)
  await saveIntegration(userId, kind, r.credentials, {
    scopes: integ.scopes,
    expiresAt: r.expiresAt,
  })
  return r.credentials
}

/**
 * Register the tools of every integration the user has
 * connected onto the given MCP server. Each tool's handler
 * decrypts the stored credentials at call time and routes
 * to the owning module's ``dispatch``.
 *
 * Intended for Pro / Team users only — the caller gates on
 * plan before invoking this.
 *
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {string} userId
 */
/**
 * Run one integration tool for a user: load + refresh
 * credentials, then dispatch. Shared by the MCP gateway
 * and the /integrations/dispatch route (used by the
 * desktop advisor). Throws on unknown kind / not connected
 * / provider error.
 *
 * @param {string} userId
 * @param {string} kind
 * @param {string} toolName
 * @param {object} args
 * @returns {Promise<*>} The tool's JSON-serialisable result.
 */
async function runIntegrationTool(userId, kind, toolName, args) {
  const mod = MODULES[kind]
  if (!mod) throw new Error(`Unknown integration: ${kind}`)
  const integ = await getIntegration(userId, kind)
  if (!integ) throw new Error(`${kind} not connected`)
  const creds = await freshCredentials(
    userId, kind, mod, integ,
  )
  return mod.dispatch(toolName, args, creds)
}

async function registerIntegrationTools(server, userId) {
  const connected = await listIntegrations(userId)
  for (const { kind } of connected) {
    const mod = MODULES[kind]
    if (!mod) continue
    for (const tool of mod.tools()) {
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
        },
        async (args) => {
          try {
            const result = await runIntegrationTool(
              userId, kind, tool.name, args,
            )
            return jsonResult(result)
          } catch (err) {
            logger.error(
              { err, kind, tool: tool.name, user_id: userId },
              "integration tool failed",
            )
            return errorResult(err.message)
          }
        },
      )
    }
  }
}

module.exports = {
  MODULES,
  registerIntegrationTools,
  runIntegrationTool,
}
