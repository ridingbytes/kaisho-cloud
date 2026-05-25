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
const {
  listIntegrations, getIntegration,
} = require("./store")

const { logger } = require("../logger")

const MODULES = {
  [linear.KIND]: linear,
  [github.KIND]: github,
}

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
            const integ = await getIntegration(userId, kind)
            if (!integ) {
              return errorResult(`${kind} not connected`)
            }
            const result = await mod.dispatch(
              tool.name, args, integ.credentials,
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

module.exports = { MODULES, registerIntegrationTools }
