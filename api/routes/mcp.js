"use strict"

/**
 * Hosted MCP (Model Context Protocol) gateway.
 *
 * Exposes the same tool surface the desktop MCP server
 * offers over stdio, but over Streamable HTTP so editors
 * like Claude Code, Cursor and Claude Desktop can reach
 * a tenant's data when the laptop is closed.
 *
 * Endpoint:    POST /mcp
 * Auth:        Authorization: Bearer <kaisho-api-key>
 * Transport:   Streamable HTTP (stateless)
 *
 * Gated behind MCP_GATEWAY_ENABLED=true at server start.
 */

const { Router } = require("express")
const { logger } = require("../logger")
const { requireApiKey } = require("../middleware")
const { registerReadTools } = require("../mcp/tools/read")
const { registerWriteTools } = require("../mcp/tools/write")
const {
  registerIntegrationTools,
} = require("../integrations")

const router = Router()

const SERVER_INFO = {
  name: "kaisho-cloud",
  version: "2.0.0",
}

/**
 * Handle a single MCP Streamable HTTP request.
 *
 * Each request spins up a fresh ``Server`` +
 * ``StreamableHTTPServerTransport``. Stateless mode
 * (no session IDs) — appropriate for read-mostly tools
 * with no server-initiated notifications. The SDK is
 * ESM-only on 1.x so we import dynamically; V8 caches
 * the modules after the first call.
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function handleMcpRequest(req, res) {
  const { McpServer } = await import(
    "@modelcontextprotocol/sdk/server/mcp.js"
  )
  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  )

  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: {} },
  })

  // Core tools, scoped to the authenticated user.
  registerReadTools(server, req.userId)
  registerWriteTools(server, req.userId)

  // Integration tools (Linear, GitHub, Slack, Google),
  // for the integrations the user has actually connected.
  await registerIntegrationTools(server, req.userId)

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  })

  res.on("close", () => {
    transport.close().catch(() => {})
    server.close().catch(() => {})
  })

  try {
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (err) {
    logger.error(
      { err, user_id: req.userId },
      "MCP request failed",
    )
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal error" },
        id: null,
      })
    }
  }
}

router.post(
  "/", requireApiKey, handleMcpRequest,
)

// Stateless transport: GET (server→client SSE) and DELETE
// (session termination) are not supported. Spec says to
// return 405 explicitly so clients fall back to POST-only.
function methodNotAllowed(_req, res) {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed" },
    id: null,
  })
}

router.get("/", methodNotAllowed)
router.delete("/", methodNotAllowed)

module.exports = router
