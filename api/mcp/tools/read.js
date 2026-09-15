"use strict"

/**
 * Read-side MCP tools served by the hosted gateway.
 *
 * Each tool maps to one of the tables the PWA
 * and desktop sync engine already populate. Tools are
 * scoped to the authenticated user via the ``userId``
 * captured at registration time — each request gets a
 * fresh ``McpServer`` instance with these tools rebound,
 * so there is no risk of cross-tenant leakage.
 *
 * Tool names match the desktop MCP server's signatures
 * so the gateway is a drop-in remote replacement.
 */

const { z } = require("zod")
const { db } = require("../../db")

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

function clampLimit(n) {
  const v = Number.isFinite(n) ? Math.floor(n) : DEFAULT_LIMIT
  return Math.max(1, Math.min(v, MAX_LIMIT))
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
 * Register all read tools on the given MCP server,
 * scoped to ``userId``.
 *
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {string} userId - Authenticated user id.
 */
function registerReadTools(server, userId) {
  registerListTasks(server, userId)
  registerListCustomers(server, userId)
  registerListClockEntries(server, userId)
  registerListInbox(server, userId)
  registerListNotes(server, userId)
}

function registerListTasks(server, userId) {
  server.registerTool(
    "list_tasks",
    {
      title: "List tasks",
      description:
        "List tasks for the authenticated user. " +
        "Optionally filter by customer or status. " +
        "Excludes soft-deleted rows.",
      inputSchema: {
        customer: z.string().optional(),
        status: z.string().optional(),
        limit: z.number().int().positive().optional(),
      },
    },
    async (args) => {
      let q = db
        .from("tasks")
        .select("*")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(clampLimit(args.limit))
      if (args.customer) q = q.eq("customer", args.customer)
      if (args.status) q = q.eq("status", args.status)
      const { data, error } = await q
      if (error) return errorResult(error.message)
      return jsonResult(data || [])
    },
  )
}

function registerListCustomers(server, userId) {
  server.registerTool(
    "list_customers",
    {
      title: "List customers",
      description:
        "List all reference customers for the " +
        "authenticated user, sorted by name.",
      inputSchema: {},
    },
    async () => {
      const { data, error } = await db
        .from("ref_customers")
        .select("name, snapshot")
        .eq("user_id", userId)
        .order("name")
      if (error) return errorResult(error.message)
      const customers = (data || []).map((r) => ({
        name: r.name,
        contracts: r.snapshot?.contracts || [],
      }))
      return jsonResult(customers)
    },
  )
}

function registerListClockEntries(server, userId) {
  server.registerTool(
    "list_clock_entries",
    {
      title: "List clock entries",
      description:
        "List time-tracking entries for the authenticated " +
        "user. ISO-8601 ``from`` / ``to`` bound the period; " +
        "default is the last 30 days. ``customer`` filters " +
        "by name. Excludes soft-deleted rows.",
      inputSchema: {
        from: z.string().optional(),
        to: z.string().optional(),
        customer: z.string().optional(),
        limit: z.number().int().positive().optional(),
      },
    },
    async (args) => {
      const fromIso = args.from || new Date(
        Date.now() - 30 * 24 * 3600 * 1000,
      ).toISOString()
      let q = db
        .from("clock_entries")
        .select("*")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .gte("start_at", fromIso)
        .order("start_at", { ascending: false })
        .limit(clampLimit(args.limit))
      if (args.to) q = q.lte("start_at", args.to)
      if (args.customer) q = q.eq("customer", args.customer)
      const { data, error } = await q
      if (error) return errorResult(error.message)
      return jsonResult(data || [])
    },
  )
}

function registerListInbox(server, userId) {
  server.registerTool(
    "list_inbox",
    {
      title: "List inbox items",
      description:
        "List inbox entries for the authenticated user. " +
        "Optionally filter by type (NOTE, EMAIL, CALL, …).",
      inputSchema: {
        type: z.string().optional(),
        limit: z.number().int().positive().optional(),
      },
    },
    async (args) => {
      let q = db
        .from("inbox_entries")
        .select("*")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(clampLimit(args.limit))
      if (args.type) q = q.eq("type", args.type)
      const { data, error } = await q
      if (error) return errorResult(error.message)
      return jsonResult(data || [])
    },
  )
}

function registerListNotes(server, userId) {
  server.registerTool(
    "list_notes",
    {
      title: "List notes",
      description:
        "List notes for the authenticated user. " +
        "Optionally filter by customer or tag. " +
        "Excludes soft-deleted rows.",
      inputSchema: {
        customer: z.string().optional(),
        tag: z.string().optional(),
        limit: z.number().int().positive().optional(),
      },
    },
    async (args) => {
      let q = db
        .from("notes")
        .select("*")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(clampLimit(args.limit))
      if (args.customer) q = q.eq("customer", args.customer)
      if (args.tag) q = q.contains("tags", [args.tag])
      const { data, error } = await q
      if (error) return errorResult(error.message)
      return jsonResult(data || [])
    },
  )
}

module.exports = { registerReadTools }
