"use strict"

const { Router } = require("express")
const { supabase } = require("../db")
const {
  requireApiKey, requireAuth,
} = require("../middleware")
const {
  validate, snapshotSchema, ackSchema, triageSchema,
} = require("../validation")

const router = Router()

// ── Sync endpoints (API key auth, local kaisho) ──────────

// POST /sync/push-snapshot
router.post(
  "/push-snapshot",
  requireApiKey,
  validate(snapshotSchema),
  async (req, res) => {
    const { customers, tasks } = req.body

    // Replace all ref_customers for this user
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

    // Replace all ref_tasks for this user
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
  },
)

// GET /sync/pull-clocks
router.get(
  "/pull-clocks",
  requireApiKey,
  async (req, res) => {
    const since = req.query.since || "1970-01-01T00:00:00Z"
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
  },
)

// POST /sync/ack-clocks
router.post(
  "/ack-clocks",
  requireApiKey,
  validate(ackSchema),
  async (req, res) => {
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
  },
)

// GET /sync/status
router.get(
  "/status",
  requireApiKey,
  async (req, res) => {
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
  },
)

// POST /sync/triage
router.post(
  "/triage",
  requireApiKey,
  validate(triageSchema),
  async (req, res) => {
    const { entries } = req.body
    let updated = 0

    for (const entry of entries) {
      const updates = {}
      if (entry.customer !== undefined) {
        updates.customer = entry.customer
      }
      if (entry.task_id !== undefined) {
        updates.task_id = entry.task_id
      }
      if (entry.contract !== undefined) {
        updates.contract = entry.contract
      }
      updates.updated_at = new Date().toISOString()

      const { error } = await supabase
        .from("clock_entries")
        .update(updates)
        .eq("id", entry.id)
        .eq("user_id", req.userId)

      if (!error) updated++
    }

    res.json({ updated })
  },
)

// ── Reference data (JWT auth, mobile reads) ──────────────

// GET /ref/customers
router.get(
  "/customers",
  requireAuth,
  async (req, res) => {
    const { data: rows } = await supabase
      .from("ref_customers")
      .select("name, snapshot")
      .eq("user_id", req.userId)
      .order("name")

    const customers = (rows || []).map((r) => ({
      name: r.name,
      contracts: r.snapshot?.contracts || [],
    }))

    res.json(customers)
  },
)

// GET /ref/tasks
router.get(
  "/tasks",
  requireAuth,
  async (req, res) => {
    let query = supabase
      .from("ref_tasks")
      .select("task_id, customer, title, status")
      .eq("user_id", req.userId)
      .order("title")

    if (req.query.customer) {
      query = query.eq("customer", req.query.customer)
    }

    const { data: rows } = await query

    const tasks = (rows || []).map((r) => ({
      id: r.task_id,
      customer: r.customer,
      title: r.title,
      status: r.status,
    }))

    res.json(tasks)
  },
)

module.exports = router
