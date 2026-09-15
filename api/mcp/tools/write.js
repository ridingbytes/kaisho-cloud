"use strict"

/**
 * Write-side MCP tools served by the hosted gateway.
 *
 * These INSERT / UPDATE the same tables the PWA
 * writes to. The desktop sync engine picks the rows up on
 * its next cycle and merges them into the local org files,
 * so no WebSocket relay is needed (see
 * docs/strategy/TRACK-AI-IMPLEMENTATION.md §4.1). Conflict model is
 * last-write-wins on ``updated_at``, matching the PWA.
 *
 * Every write broadcasts the matching WS event so a live
 * PWA session refreshes immediately.
 *
 * Tools are scoped to the authenticated user via the
 * ``userId`` captured at registration time.
 */

const { randomUUID } = require("crypto")
const { z } = require("zod")
const { DEFAULT_TASK_STATUS } = require("../../config")
const { db } = require("../../db")
const { broadcast } = require("../../ws")
const { parseDuration } = require("../../utils/clocks")

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
 * Register all write tools on the given MCP server,
 * scoped to ``userId``.
 *
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {string} userId - Authenticated user id.
 */
function registerWriteTools(server, userId) {
  registerAddTask(server, userId)
  registerUpdateTask(server, userId)
  registerMoveTask(server, userId)
  registerBookTime(server, userId)
  registerAddInboxItem(server, userId)
  registerAddNote(server, userId)
}

function registerAddTask(server, userId) {
  server.registerTool(
    "add_task",
    {
      title: "Add task",
      description:
        "Create a task. Syncs to the user's desktop on " +
        "the next cycle. Returns the created row.",
      inputSchema: {
        title: z.string().min(1),
        customer: z.string().optional(),
        status: z.string().optional(),
        tags: z.array(z.string()).optional(),
        body: z.string().optional(),
        github_url: z.string().optional(),
      },
    },
    async (args) => {
      const now = new Date().toISOString()
      const row = {
        id: randomUUID(),
        user_id: userId,
        customer: args.customer ?? "",
        title: args.title,
        status: args.status ?? DEFAULT_TASK_STATUS,
        tags: args.tags ?? [],
        body: args.body ?? "",
        github_url: args.github_url ?? "",
        created_at: now,
        updated_at: now,
        deleted_at: null,
      }
      const { data, error } = await db
        .from("tasks")
        .insert(row)
        .select()
        .single()
      if (error) return errorResult(error.message)
      broadcast(userId, "tasks:changed", { count: 1 })
      return jsonResult(data)
    },
  )
}

function registerUpdateTask(server, userId) {
  server.registerTool(
    "update_task",
    {
      title: "Update task",
      description:
        "Update fields on an existing task by id (the " +
        "id returned by list_tasks). Only supplied fields " +
        "change. Returns the updated row.",
      inputSchema: {
        id: z.string().min(1),
        customer: z.string().optional(),
        title: z.string().optional(),
        status: z.string().optional(),
        tags: z.array(z.string()).optional(),
        body: z.string().optional(),
        github_url: z.string().optional(),
      },
    },
    async (args) => {
      const updates = { updated_at: new Date().toISOString() }
      for (const k of [
        "customer", "title", "status", "tags",
        "body", "github_url",
      ]) {
        if (args[k] !== undefined) updates[k] = args[k]
      }
      const { data, error } = await db
        .from("tasks")
        .update(updates)
        .eq("user_id", userId)
        .eq("id", args.id)
        .is("deleted_at", null)
        .select()
        .maybeSingle()
      if (error) return errorResult(error.message)
      if (!data) return errorResult("Task not found")
      broadcast(userId, "tasks:changed", { count: 1 })
      return jsonResult(data)
    },
  )
}

function registerMoveTask(server, userId) {
  server.registerTool(
    "move_task",
    {
      title: "Move task",
      description:
        "Change a task's status (e.g. TODO, DOING, DONE) " +
        "by id. Returns the updated row.",
      inputSchema: {
        id: z.string().min(1),
        status: z.string().min(1),
      },
    },
    async (args) => {
      const { data, error } = await db
        .from("tasks")
        .update({
          status: args.status,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("id", args.id)
        .is("deleted_at", null)
        .select()
        .maybeSingle()
      if (error) return errorResult(error.message)
      if (!data) return errorResult("Task not found")
      broadcast(userId, "tasks:changed", { count: 1 })
      return jsonResult(data)
    },
  )
}

function registerBookTime(server, userId) {
  server.registerTool(
    "book_time",
    {
      title: "Book time",
      description:
        "Book a completed time entry. ``duration`` is a " +
        "string like \"2h\", \"90m\", \"1h30m\". Without " +
        "``date`` (YYYY-MM-DD) the entry ends now and " +
        "starts ``duration`` ago. Returns the created row.",
      inputSchema: {
        duration: z.string().min(1),
        customer: z.string().optional(),
        description: z.string().optional(),
        task_id: z.string().optional(),
        contract: z.string().optional(),
        date: z.string().optional(),
      },
    },
    async (args) => {
      const minutes = parseDuration(args.duration)
      if (minutes === null || minutes <= 0) {
        return errorResult(
          `Invalid duration: ${args.duration}`,
        )
      }
      let startAt
      if (args.date) {
        startAt = new Date(`${args.date}T12:00:00Z`)
        if (Number.isNaN(startAt.getTime())) {
          return errorResult(
            `Invalid date: ${args.date} ` +
            "(expected YYYY-MM-DD)",
          )
        }
      } else {
        startAt = new Date(Date.now() - minutes * 60000)
      }
      const endAt = new Date(
        startAt.getTime() + minutes * 60000,
      )
      const { data, error } = await db
        .from("clock_entries")
        .insert({
          user_id: userId,
          customer: args.customer || null,
          description: args.description || "",
          start_at: startAt.toISOString(),
          end_at: endAt.toISOString(),
          task_id: args.task_id || null,
          contract: args.contract || null,
        })
        .select()
        .single()
      if (error) return errorResult(error.message)
      broadcast(userId, "entries:changed", { count: 1 })
      return jsonResult(data)
    },
  )
}

function registerAddInboxItem(server, userId) {
  server.registerTool(
    "add_inbox_item",
    {
      title: "Add inbox item",
      description:
        "Capture an item into the inbox. ``type`` is one " +
        "of NOTE, EMAIL, CALL, … (default NOTE). Returns " +
        "the created row.",
      inputSchema: {
        title: z.string().min(1),
        body: z.string().optional(),
        type: z.string().optional(),
        customer: z.string().optional(),
      },
    },
    async (args) => {
      const now = new Date().toISOString()
      const row = {
        id: randomUUID(),
        user_id: userId,
        type: args.type ?? "NOTE",
        customer: args.customer ?? "",
        title: args.title,
        body: args.body ?? "",
        channel: "",
        direction: "in",
        created_at: now,
        updated_at: now,
        deleted_at: null,
      }
      const { data, error } = await db
        .from("inbox_entries")
        .insert(row)
        .select()
        .single()
      if (error) return errorResult(error.message)
      broadcast(userId, "inbox:changed", { count: 1 })
      return jsonResult(data)
    },
  )
}

function registerAddNote(server, userId) {
  server.registerTool(
    "add_note",
    {
      title: "Add note",
      description:
        "Create a note. Optionally attach it to a task " +
        "via ``task_id``. Returns the created row.",
      inputSchema: {
        title: z.string().min(1),
        body: z.string().optional(),
        customer: z.string().optional(),
        tags: z.array(z.string()).optional(),
        task_id: z.string().optional(),
      },
    },
    async (args) => {
      const now = new Date().toISOString()
      const row = {
        id: randomUUID(),
        user_id: userId,
        customer: args.customer ?? "",
        title: args.title,
        body: args.body ?? "",
        tags: args.tags ?? [],
        task_id: args.task_id ?? null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      }
      const { data, error } = await db
        .from("notes")
        .insert(row)
        .select()
        .single()
      if (error) return errorResult(error.message)
      broadcast(userId, "notes:changed", { count: 1 })
      return jsonResult(data)
    },
  )
}

module.exports = { registerWriteTools }
