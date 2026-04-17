"use strict"

/**
 * @module routes/sync
 *
 * Bidirectional sync endpoints (API-key auth). These
 * routes let the local Kaisho desktop app push and pull
 * clock entries against the Supabase cloud store using a
 * cursor-based, last-writer-wins merge protocol.
 *
 * Endpoint contract:
 *   GET  /sync/changes        Pull entries + tombstones
 *                              changed after ?since cursor
 *   POST /sync/apply          Upsert a batch of entries
 *                              (last-writer-wins on
 *                              updated_at; soft-deletes)
 *   GET  /sync/active         Current running timer
 *   POST /sync/active/start   Start / reconcile timer
 *                              (later start_at wins)
 *   POST /sync/active/stop    Stop the running timer
 *   GET  /sync/stats          Count, last_change_at
 *   POST /sync/push-snapshot  Replace ref customers/tasks
 */

const { Router } = require("express")
const { supabase } = require("../db")
const { requireApiKey } = require("../middleware")
const {
  validate,
  validateQuery,
  snapshotSchema,
  syncApplySchema,
  activeStartSchema,
  activeStopSchema,
  syncChangesQuerySchema,
} = require("../validation")
const { asyncHandler } = require("../utils/asyncHandler")

const router = Router()

// ── Helpers ─────────────────────────────────────────────

/**
 * Shape a DB row into the wire format for /sync endpoints.
 * Deleted rows carry deleted_at; end_at may be null for
 * a running timer.
 *
 * @param {object} row - Supabase clock_entries row.
 * @returns {object} Wire-format entry with renamed
 *   fields (start_at -> start, end_at -> end).
 */
function rowToWire(row) {
  return {
    id: row.id,
    customer: row.customer || null,
    description: row.description || "",
    start: row.start_at,
    end: row.end_at || null,
    task_id: row.task_id || null,
    contract: row.contract || null,
    notes: row.notes || "",
    invoiced: row.invoiced || false,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at || null,
  }
}

// ── POST /sync/push-snapshot ────────────────────────────

/**
 * Replace all reference customers and tasks for the
 * authenticated user with a fresh snapshot.
 *
 * @route POST /sync/push-snapshot
 */
router.post(
  "/push-snapshot",
  requireApiKey,
  validate(snapshotSchema),
  asyncHandler(async (req, res) => {
    const { customers, tasks } = req.body

    await supabase
      .from("ref_customers")
      .delete()
      .eq("user_id", req.userId)

    if (customers.length > 0) {
      await supabase.from("ref_customers").insert(
        customers.map((c) => ({
          user_id: req.userId,
          name: c.name,
          snapshot: {
            contracts: c.contracts || [],
          },
        })),
      )
    }

    await supabase
      .from("ref_tasks")
      .delete()
      .eq("user_id", req.userId)

    if (tasks.length > 0) {
      await supabase.from("ref_tasks").insert(
        tasks.map((t) => ({
          user_id: req.userId,
          task_id: t.id,
          customer: t.customer || null,
          title: t.title,
          status: t.status,
        })),
      )
    }

    res.json({ ok: true })
  }),
)

// ── GET /sync/changes ───────────────────────────────────

/**
 * Return all entries (live + tombstones) with
 * updated_at > ?since, ordered for resumable pulling.
 *
 * @route GET /sync/changes?since=<iso>&limit=<int>
 */
router.get(
  "/changes",
  requireApiKey,
  validateQuery(syncChangesQuerySchema),
  asyncHandler(async (req, res) => {
    const since =
      req.query.since || "1970-01-01T00:00:00Z"
    const limit = Math.min(
      parseInt(req.query.limit) || 200, 500,
    )

    const { data: rows, error } = await supabase
      .from("clock_entries")
      .select("*")
      .eq("user_id", req.userId)
      .gt("updated_at", since)
      .order("updated_at", { ascending: true })
      .limit(limit)

    if (error) {
      req.log.error(
        { err: error, since, limit },
        "sync/changes query failed",
      )
      return res
        .status(500)
        .json({ error: "Failed to fetch changes" })
    }

    const cursor =
      rows.length > 0
        ? rows[rows.length - 1].updated_at
        : since

    res.json({
      now: new Date().toISOString(),
      cursor,
      entries: rows.map(rowToWire),
      has_more: rows.length === limit,
    })
  }),
)

// ── POST /sync/apply ────────────────────────────────────

/**
 * Allowlisted DB columns for sync/apply updates. Only
 * these fields are written during an update to prevent
 * overwriting user_id or id.
 *
 * @type {string[]}
 */
const APPLY_FIELDS = [
  "customer", "description", "start_at", "end_at",
  "task_id", "contract", "notes", "invoiced",
]

/**
 * Build the upsert payload for one incoming entry,
 * mapping wire names to DB columns (start -> start_at,
 * end -> end_at). Always stamps a fresh updated_at.
 *
 * @param {object} entry - Wire-format sync entry.
 * @param {string} userId - Authenticated user ID.
 * @returns {object} Row object ready for Supabase
 *   insert or update.
 */
function wireToRow(entry, userId) {
  return {
    id: entry.id,
    user_id: userId,
    customer: entry.customer ?? null,
    description: entry.description ?? "",
    start_at: entry.start,
    end_at: entry.end ?? null,
    task_id: entry.task_id ?? null,
    contract: entry.contract ?? null,
    notes: entry.notes ?? "",
    invoiced: entry.invoiced ?? false,
    deleted_at: entry.deleted_at ?? null,
    updated_at: new Date().toISOString(),
  }
}

/**
 * Last-writer-wins merge decision. Compares updated_at
 * timestamps to decide whether to insert, update, or
 * skip the incoming entry.
 *
 * @param {object|null} existing - Current DB row, or
 *   null if no row exists for this id.
 * @param {object} incoming - Wire-format entry with
 *   updated_at timestamp.
 * @returns {{ action: string, reason?: string }}
 *   action is "insert" | "update" | "skip".
 */
function decideMerge(existing, incoming) {
  if (!existing) return { action: "insert" }
  const existingUpd = new Date(existing.updated_at)
  const incomingUpd = new Date(incoming.updated_at)
  if (incomingUpd <= existingUpd) {
    return { action: "skip", reason: "stale" }
  }
  return { action: "update" }
}

/**
 * Apply a single incoming sync entry: fetch the existing
 * row (if any), run the merge decision, then insert or
 * update accordingly.
 *
 * @param {object} entry - Wire-format sync entry.
 * @param {string} userId - Authenticated user ID.
 * @returns {Promise<{action: string, id: string}>}
 *   Result with the action taken and entry id.
 */
async function applyOneEntry(entry, userId) {
  const { data: existing } = await supabase
    .from("clock_entries")
    .select("id, updated_at, deleted_at")
    .eq("id", entry.id)
    .eq("user_id", userId)
    .maybeSingle()

  const decision = decideMerge(existing, entry)
  if (decision.action === "skip") {
    return { action: "skip", id: entry.id }
  }

  const row = wireToRow(entry, userId)
  if (decision.action === "insert") {
    const { error } = await supabase
      .from("clock_entries")
      .insert(row)
    if (error) {
      return { action: "error", id: entry.id, error }
    }
    return { action: "insert", id: entry.id }
  }

  const updates = {}
  for (const k of APPLY_FIELDS) updates[k] = row[k]
  updates.deleted_at = row.deleted_at
  updates.updated_at = row.updated_at

  const { error } = await supabase
    .from("clock_entries")
    .update(updates)
    .eq("id", entry.id)
    .eq("user_id", userId)

  if (error) {
    return { action: "error", id: entry.id, error }
  }
  return { action: "update", id: entry.id }
}

/**
 * Apply a batch of incoming entries. Idempotent.
 *
 * @route POST /sync/apply
 */
router.post(
  "/apply",
  requireApiKey,
  validate(syncApplySchema),
  asyncHandler(async (req, res) => {
    const { entries } = req.body
    const counts = {
      inserted: 0, updated: 0, skipped: 0, errors: 0,
    }
    const errorIds = []

    for (const entry of entries) {
      const result = await applyOneEntry(entry, req.userId)
      if (result.action === "insert") counts.inserted++
      else if (result.action === "update") counts.updated++
      else if (result.action === "skip") counts.skipped++
      else {
        counts.errors++
        errorIds.push(result.id)
      }
    }

    res.json({
      ...counts,
      errors: errorIds,
      applied_at: new Date().toISOString(),
    })
  }),
)

// ── GET /sync/active ────────────────────────────────────

/**
 * Return the cloud-side running timer for this user.
 *
 * @route GET /sync/active
 */
router.get(
  "/active",
  requireApiKey,
  asyncHandler(async (req, res) => {
    const { data: row } = await supabase
      .from("clock_entries")
      .select("*")
      .eq("user_id", req.userId)
      .is("end_at", null)
      .is("deleted_at", null)
      .maybeSingle()

    if (!row) return res.json({ active: false })

    res.json({ active: true, ...rowToWire(row) })
  }),
)

// ── POST /sync/active/start ─────────────────────────────

/**
 * Start / reconcile an active timer across devices.
 *
 * Rule ("later start_at wins"):
 *   - No active timer    -> insert the incoming one.
 *   - Incoming.start_at later -> auto-stop the current
 *     active timer at incoming.start_at, then insert the
 *     incoming one.
 *   - Incoming.start_at earlier or equal -> ignore the
 *     incoming start; return the existing winner.
 *
 * @route POST /sync/active/start
 */
router.post(
  "/active/start",
  requireApiKey,
  validate(activeStartSchema),
  asyncHandler(async (req, res) => {
    const incoming = req.body
    const now = new Date().toISOString()

    const { data: active } = await supabase
      .from("clock_entries")
      .select("*")
      .eq("user_id", req.userId)
      .is("end_at", null)
      .is("deleted_at", null)
      .maybeSingle()

    if (active) {
      // Same id already running — idempotent replay.
      if (active.id === incoming.id) {
        return res.json({
          active: true,
          winner: "existing",
          ...rowToWire(active),
        })
      }
      const existingStart = new Date(active.start_at)
      const incomingStart = new Date(incoming.start)
      if (incomingStart <= existingStart) {
        return res.json({
          active: true,
          winner: "existing",
          ...rowToWire(active),
        })
      }
      await supabase
        .from("clock_entries")
        .update({
          end_at: incoming.start,
          updated_at: now,
        })
        .eq("id", active.id)
    }

    const { data: row, error } = await supabase
      .from("clock_entries")
      .insert({
        id: incoming.id,
        user_id: req.userId,
        customer: incoming.customer || null,
        description: incoming.description || "",
        start_at: incoming.start,
        task_id: incoming.task_id || null,
        contract: incoming.contract || null,
      })
      .select()
      .single()

    if (error) {
      return res
        .status(500)
        .json({ error: "Failed to start timer" })
    }

    res.status(201).json({
      active: true,
      winner: "incoming",
      ...rowToWire(row),
    })
  }),
)

// ── POST /sync/active/stop ──────────────────────────────

/**
 * Stop the currently running timer. Idempotent: returns
 * the stopped entry (or 404 if there was none).
 *
 * @route POST /sync/active/stop
 */
router.post(
  "/active/stop",
  requireApiKey,
  validate(activeStopSchema),
  asyncHandler(async (req, res) => {
    const { id, end } = req.body
    const now = new Date().toISOString()
    const endAt = end || now

    let query = supabase
      .from("clock_entries")
      .select("*")
      .eq("user_id", req.userId)
      .is("end_at", null)
      .is("deleted_at", null)
    if (id) query = query.eq("id", id)

    const { data: active } = await query.maybeSingle()

    if (!active) {
      return res
        .status(404)
        .json({ error: "No running timer" })
    }

    const { data: row, error } = await supabase
      .from("clock_entries")
      .update({ end_at: endAt, updated_at: now })
      .eq("id", active.id)
      .select()
      .single()

    if (error) {
      return res
        .status(500)
        .json({ error: "Failed to stop timer" })
    }

    res.json(rowToWire(row))
  }),
)

// ── POST /sync/ack ──────────────────────────────────────

/**
 * Mark entries as synced (pulled by the local app).
 * Stamps ``synced_at`` so the mobile UI can show whether
 * the local app has seen each entry.
 *
 * @route POST /sync/ack
 */
router.post(
  "/ack",
  requireApiKey,
  asyncHandler(async (req, res) => {
    const { ids } = req.body
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        error: "ids must be a non-empty array",
      })
    }
    const now = new Date().toISOString()
    const { error, count } = await supabase
      .from("clock_entries")
      .update({ synced_at: now })
      .eq("user_id", req.userId)
      .in("id", ids.slice(0, 500))
      .is("synced_at", null)

    if (error) {
      return res
        .status(500)
        .json({ error: "Failed to ack" })
    }

    res.json({ acked: count || ids.length })
  }),
)

// ── DELETE /sync/entries ─────────────────────────────────

/**
 * Hard-delete all clock entries for the authenticated
 * user. Called by the desktop app during disconnect to
 * ensure the cloud is a clean slate for the next
 * connection.
 *
 * The local org file is the single source of truth —
 * the cloud is a disposable mirror that gets rebuilt
 * from a full push on the next connect.
 *
 * @route DELETE /sync/entries
 */
router.delete(
  "/entries",
  requireApiKey,
  asyncHandler(async (req, res) => {
    const { error, count } = await supabase
      .from("clock_entries")
      .delete()
      .eq("user_id", req.userId)

    if (error) {
      req.log.error(
        { err: error },
        "Failed to wipe entries",
      )
      return res
        .status(500)
        .json({ error: "Failed to wipe entries" })
    }

    res.json({ deleted: count || 0 })
  }),
)

// ── GET /sync/stats ─────────────────────────────────────

/**
 * Lightweight snapshot of sync state for observability.
 *
 * @route GET /sync/stats
 */
router.get(
  "/stats",
  requireApiKey,
  asyncHandler(async (req, res) => {
    const { count: entryCount } = await supabase
      .from("clock_entries")
      .select("id", { count: "exact", head: true })
      .eq("user_id", req.userId)
      .is("deleted_at", null)

    const { data: latest } = await supabase
      .from("clock_entries")
      .select("updated_at")
      .eq("user_id", req.userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    const { data: active } = await supabase
      .from("clock_entries")
      .select("id")
      .eq("user_id", req.userId)
      .is("end_at", null)
      .is("deleted_at", null)
      .maybeSingle()

    const { data: user } = await supabase
      .from("users")
      .select("plan")
      .eq("id", req.userId)
      .single()

    res.json({
      entry_count: entryCount || 0,
      last_change_at: latest?.updated_at || null,
      active_timer_id: active?.id || null,
      plan: user?.plan || "free",
    })
  }),
)

// ── GET /sync/status (legacy alias) ─────────────────────

/**
 * Back-compat shim pointing at /sync/stats. The local app
 * may probe this endpoint from older builds.
 *
 * @route GET /sync/status
 */
router.get(
  "/status",
  requireApiKey,
  asyncHandler(async (req, res) => {
    const { data: user } = await supabase
      .from("users")
      .select("plan")
      .eq("id", req.userId)
      .single()
    res.json({ plan: user?.plan || "free", pending: 0 })
  }),
)

module.exports = router
