"use strict"

/**
 * @module routes/sync
 *
 * Bidirectional sync endpoints (JWT or API-key auth).
 * These routes let the mobile PWA and the local Kaisho
 * desktop app push and pull
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
const {
  syncLimiter, DEFAULT_TASK_STATUS,
} = require("../config")
const {
  requireAuth, requirePlan,
} = require("../middleware")
// Any paid tier grants sync. Free is gated.
const requireSync = requirePlan("companion", "pro", "team")
const { broadcast } = require("../ws")
const {
  validate,
  validateQuery,
  snapshotSchema,
  syncApplySchema,
  inboxApplySchema,
  taskApplySchema,
  noteApplySchema,
  activeStartSchema,
  activeStopSchema,
  syncChangesQuerySchema,
} = require("../validation")
const { asyncHandler } = require("../utils/asyncHandler")
const { mountSyncResource } = require("./syncResource")

const router = Router()

router.use(syncLimiter)

// ── Helpers ─────────────────────────────────────────────

/**
 * Insert rows with per-row retry on batch failure.
 *
 * Supabase rejects the WHOLE batch if any row violates a
 * constraint (e.g. one bad task_id FK in 500 rows). The
 * previous "attribute the failure to every id in the
 * batch" behaviour made the client retry every row of
 * every batch forever, hiding the one bad row.
 *
 * Strategy: try the bulk insert first (the fast path).
 * If it fails, fall back to inserting each row on its
 * own so the bad rows are isolated to their own id.
 *
 * @param {string} table - Supabase table name.
 * @param {object[]} rows - Rows to insert.
 * @returns {Promise<string[]>} IDs that failed to insert.
 */
async function insertWithRowRetry(table, rows) {
  if (rows.length === 0) return []
  const { error } = await supabase.from(table).insert(rows)
  if (!error) return []
  const failedIds = []
  for (const row of rows) {
    const { error: rowErr } = await supabase
      .from(table)
      .insert(row)
    if (rowErr) failedIds.push(row.id)
  }
  return failedIds
}


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
  requireAuth,
  requireSync,
  validate(snapshotSchema),
  asyncHandler(async (req, res) => {
    const { customers, tasks, config } = req.body

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

    // Store config (tags, feature flags). The validator
    // strips unknown keys, so ``config`` here is exactly
    // what we accept and persist. We echo it back so the
    // client can digest the *stored* shape rather than its
    // local payload; that way a schema mismatch (e.g.
    // older server, newer client field) doesn't leave the
    // client's digest convinced a field was pushed when
    // the server actually dropped it.
    let stored_config = null
    if (config) {
      const { error: cfgErr } = await supabase
        .from("ref_config")
        .upsert(
          {
            user_id: req.userId,
            config,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        )
      if (cfgErr) {
        req.log.error(
          { err: cfgErr },
          "ref_config upsert failed",
        )
      } else {
        stored_config = config
      }
    }

    res.json({ ok: true, config: stored_config })
  }),
)

// ── GET /sync/changes ───────────────────────────────────

/**
 * Return all entries (live + tombstones) with
 * updated_at > ?since, ordered for resumable pulling.
 *
 * @route GET /sync/changes?since=<iso>&limit=<int>
 */
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
    // Preserve the client's updated_at. Stamping a fresh
    // server timestamp here causes a sync echo loop:
    // - Client A pushes entry at T1 with updated_at=T1
    // - Server bumps to T2 (now)
    // - Client A's next pull (since=T1_pull_old) sees
    //   updated_at=T2 > T1_pull_old, fetches the entry
    // - Apply locally, set local updated_at=T2
    // - Next push collects entries with
    //   updated_at>push_cursor and re-pushes the entry
    // - Server bumps to T3 ...
    // LWW correctness only requires a monotonic ordering
    // PER ENTRY, which the client already provides; we
    // honor it.
    updated_at: entry.updated_at
      || new Date().toISOString(),
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

mountSyncResource(router, {
  table: "clock_entries",
  pathPrefix: "",
  applyFields: APPLY_FIELDS,
  applySchema: syncApplySchema,
  rowToWire,
  wireToRow,
  broadcastEvent: "entries:changed",
}, {
  supabase, broadcast,
  decideMerge, insertWithRowRetry,
  validate, validateQuery, syncChangesQuerySchema,
  requireAuth, requireSync, asyncHandler,
})


// ── GET /sync/active ────────────────────────────────────

/**
 * Return the cloud-side running timer for this user.
 *
 * @route GET /sync/active
 */
router.get(
  "/active",
  requireAuth,
  requireSync,
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
  requireAuth,
  requireSync,
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

    const wire = rowToWire(row)
    res.status(201).json({
      active: true,
      winner: "incoming",
      ...wire,
    })
    process.nextTick(() =>
      broadcast(req.userId, "timer:started", wire),
    )
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
  requireAuth,
  requireSync,
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

    const wire = rowToWire(row)
    res.json(wire)
    process.nextTick(() =>
      broadcast(req.userId, "timer:stopped", wire),
    )
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
  requireAuth,
  requireSync,
  asyncHandler(async (req, res) => {
    // Atomic single-transaction wipe via the
    // wipe_user_sync_state RPC (migration 018). The
    // previous per-table loop would leave the user
    // half-wiped if any DELETE failed midway through the
    // six tables, and the next reconnect would mix fresh
    // pushed rows with stale leftovers.
    const { data: deleted, error } = await supabase.rpc(
      "wipe_user_sync_state",
      { p_user_id: req.userId },
    )
    if (error) {
      req.log.error(
        { err: error },
        "wipe_user_sync_state RPC failed",
      )
      return res.status(500).json({
        error: "Failed to wipe user sync state",
      })
    }
    res.json({ deleted: deleted || 0 })
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
  requireAuth,
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

    // Fetch email from Supabase Auth
    const { data: authData } =
      await supabase.auth.admin.getUserById(
        req.userId,
      )

    res.json({
      entry_count: entryCount || 0,
      last_change_at: latest?.updated_at || null,
      active_timer_id: active?.id || null,
      plan: user?.plan || "free",
      email: authData?.user?.email || null,
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
  requireAuth,
  asyncHandler(async (req, res) => {
    const { data: user } = await supabase
      .from("users")
      .select("plan")
      .eq("id", req.userId)
      .single()
    res.json({ plan: user?.plan || "free", pending: 0 })
  }),
)

// ── Inbox sync ────────────────────────────────────────────
//
// Same cursor-based LWW pattern as clock entries, against
// the inbox_entries table.

/**
 * Shape a DB inbox row into wire format.
 *
 * @param {object} row - Supabase inbox_entries row.
 * @returns {object} Wire-format inbox item.
 */
function inboxRowToWire(row) {
  return {
    id: row.id,
    type: row.type || "NOTE",
    customer: row.customer || "",
    title: row.title || "",
    body: row.body || "",
    channel: row.channel || "",
    direction: row.direction || "in",
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at || null,
  }
}

/**
 * Build DB row from wire-format inbox item.
 *
 * @param {object} entry - Wire-format inbox item.
 * @param {string} userId - Authenticated user ID.
 * @returns {object} Row for Supabase upsert.
 */
function inboxWireToRow(entry, userId) {
  return {
    id: entry.id,
    user_id: userId,
    type: entry.type ?? "NOTE",
    customer: entry.customer ?? "",
    title: entry.title ?? "",
    body: entry.body ?? "",
    channel: entry.channel ?? "",
    direction: entry.direction ?? "in",
    created_at: entry.created_at ?? new Date().toISOString(),
    deleted_at: entry.deleted_at ?? null,
    // Preserve client's updated_at — see clocks
    // wireToRow comment for the echo-loop rationale.
    updated_at: entry.updated_at
      || new Date().toISOString(),
  }
}

const INBOX_APPLY_FIELDS = [
  "type", "customer", "title", "body",
  "channel", "direction", "created_at",
]

mountSyncResource(router, {
  table: "inbox_entries",
  pathPrefix: "/inbox",
  applyFields: INBOX_APPLY_FIELDS,
  applySchema: inboxApplySchema,
  rowToWire: inboxRowToWire,
  wireToRow: inboxWireToRow,
  broadcastEvent: "inbox:changed",
}, {
  supabase, broadcast,
  decideMerge, insertWithRowRetry,
  validate, validateQuery, syncChangesQuerySchema,
  requireAuth, requireSync, asyncHandler,
})

// ── Task sync ─────────────────────────────────────────────

function taskRowToWire(row) {
  return {
    id: row.id,
    customer: row.customer || "",
    title: row.title || "",
    status: row.status || DEFAULT_TASK_STATUS,
    tags: row.tags || [],
    body: row.body || "",
    github_url: row.github_url || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at || null,
  }
}

function taskWireToRow(entry, userId) {
  return {
    id: entry.id,
    user_id: userId,
    customer: entry.customer ?? "",
    title: entry.title ?? "",
    status: entry.status ?? DEFAULT_TASK_STATUS,
    tags: entry.tags ?? [],
    body: entry.body ?? "",
    github_url: entry.github_url ?? "",
    created_at: entry.created_at
      ?? new Date().toISOString(),
    deleted_at: entry.deleted_at ?? null,
    // Preserve client's updated_at — see clocks
    // wireToRow comment for the echo-loop rationale.
    updated_at: entry.updated_at
      || new Date().toISOString(),
  }
}

const TASK_APPLY_FIELDS = [
  "customer", "title", "status", "tags",
  "body", "github_url", "created_at",
]

mountSyncResource(router, {
  table: "tasks",
  pathPrefix: "/tasks",
  applyFields: TASK_APPLY_FIELDS,
  applySchema: taskApplySchema,
  rowToWire: taskRowToWire,
  wireToRow: taskWireToRow,
  broadcastEvent: "tasks:changed",
}, {
  supabase, broadcast,
  decideMerge, insertWithRowRetry,
  validate, validateQuery, syncChangesQuerySchema,
  requireAuth, requireSync, asyncHandler,
})

// ── Notes sync ────────────────────────────────────────────

function noteRowToWire(row) {
  return {
    id: row.id,
    customer: row.customer || "",
    title: row.title || "",
    body: row.body || "",
    tags: row.tags || [],
    task_id: row.task_id || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at || null,
  }
}

function noteWireToRow(entry, userId) {
  return {
    id: entry.id,
    user_id: userId,
    customer: entry.customer ?? "",
    title: entry.title ?? "",
    body: entry.body ?? "",
    tags: entry.tags ?? [],
    task_id: entry.task_id ?? null,
    created_at: entry.created_at
      ?? new Date().toISOString(),
    deleted_at: entry.deleted_at ?? null,
    // Preserve client's updated_at — see clocks
    // wireToRow comment for the echo-loop rationale.
    updated_at: entry.updated_at
      || new Date().toISOString(),
  }
}

const NOTE_APPLY_FIELDS = [
  "customer", "title", "body", "tags",
  "task_id", "created_at",
]

mountSyncResource(router, {
  table: "notes",
  pathPrefix: "/notes",
  applyFields: NOTE_APPLY_FIELDS,
  applySchema: noteApplySchema,
  rowToWire: noteRowToWire,
  wireToRow: noteWireToRow,
  broadcastEvent: "notes:changed",
}, {
  supabase, broadcast,
  decideMerge, insertWithRowRetry,
  validate, validateQuery, syncChangesQuerySchema,
  requireAuth, requireSync, asyncHandler,
})


module.exports = router
