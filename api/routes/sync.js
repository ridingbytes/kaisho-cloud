"use strict"

/**
 * Sync endpoints (API key auth, local kaisho client).
 *
 * Handles snapshot push, clock pull/ack, status, and
 * triage operations for the desktop sync client.
 */

const { Router } = require("express")
const { supabase } = require("../db")
const { requireApiKey } = require("../middleware")
const {
  validate,
  validateQuery,
  snapshotSchema,
  ackSchema,
  triageSchema,
  pullClocksQuerySchema,
} = require("../validation")
const { asyncHandler } = require("../utils/asyncHandler")
const { buildUpdates } = require("../utils/updates")

const router = Router()

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

// ── GET /sync/pull-clocks ───────────────────────────────

/**
 * Pull unsynced completed clock entries created after
 * the given cursor.
 *
 * @route GET /sync/pull-clocks?since=&limit=
 */
router.get(
  "/pull-clocks",
  requireApiKey,
  validateQuery(pullClocksQuerySchema),
  asyncHandler(async (req, res) => {
    const since =
      req.query.since || "1970-01-01T00:00:00Z"
    const limit = Math.min(
      parseInt(req.query.limit) || 100, 500,
    )

    const { data: rows, error } = await supabase
      .from("clock_entries")
      .select("*")
      .eq("user_id", req.userId)
      .eq("synced", false)
      .not("end_at", "is", null)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(limit)

    if (error) {
      return res
        .status(500)
        .json({ error: "Failed to pull clocks" })
    }

    const entries = rows.map((r) => ({
      id: r.id,
      customer: r.customer || null,
      description: r.description,
      start: r.start_at,
      end: r.end_at,
      task_id: r.task_id || null,
      contract: r.contract || null,
      notes: r.notes || "",
      booked: r.booked || false,
    }))

    const cursor =
      rows.length > 0
        ? rows[rows.length - 1].created_at
        : since

    res.json({ entries, cursor })
  }),
)

// ── POST /sync/ack-clocks ───────────────────────────────

/**
 * Mark clock entries as synced by their IDs.
 *
 * @route POST /sync/ack-clocks
 */
router.post(
  "/ack-clocks",
  requireApiKey,
  validate(ackSchema),
  asyncHandler(async (req, res) => {
    const { entry_ids } = req.body
    const now = new Date().toISOString()

    const { error, count } = await supabase
      .from("clock_entries")
      .update({ synced: true, synced_at: now })
      .eq("user_id", req.userId)
      .in("id", entry_ids)

    if (error) {
      return res
        .status(500)
        .json({ error: "Failed to acknowledge" })
    }

    res.json({ acked: count || entry_ids.length })
  }),
)

// ── GET /sync/status ────────────────────────────────────

/**
 * Return the count of pending (unsynced) clock entries
 * and the user plan.
 *
 * @route GET /sync/status
 */
router.get(
  "/status",
  requireApiKey,
  asyncHandler(async (req, res) => {
    const { count: pending } = await supabase
      .from("clock_entries")
      .select("id", { count: "exact", head: true })
      .eq("user_id", req.userId)
      .eq("synced", false)
      .not("end_at", "is", null)

    const { data: user } = await supabase
      .from("users")
      .select("plan")
      .eq("id", req.userId)
      .single()

    res.json({
      pending: pending || 0,
      plan: user?.plan || "free",
    })
  }),
)

// ── POST /sync/triage ───────────────────────────────────

const TRIAGE_FIELDS = ["customer", "task_id", "contract"]

/**
 * Batch-update customer, task, and contract fields on
 * multiple clock entries.
 *
 * @route POST /sync/triage
 */
router.post(
  "/triage",
  requireApiKey,
  validate(triageSchema),
  asyncHandler(async (req, res) => {
    const { entries } = req.body
    let updated = 0

    for (const entry of entries) {
      const updates = buildUpdates(entry, TRIAGE_FIELDS)
      updates.updated_at = new Date().toISOString()

      const { error } = await supabase
        .from("clock_entries")
        .update(updates)
        .eq("id", entry.id)
        .eq("user_id", req.userId)

      if (!error) updated++
    }

    res.json({ updated })
  }),
)

module.exports = router
