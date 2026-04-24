"use strict"

/**
 * Reference data endpoints (JWT auth, mobile reads).
 *
 * Serves synced customer and task data to the mobile
 * app.
 */

const { Router } = require("express")
const { supabase } = require("../db")
const { requireAuth } = require("../middleware")
const { asyncHandler } = require("../utils/asyncHandler")

const router = Router()

// ── GET /ref/customers ──────────────────────────────────

/**
 * List all reference customers for the authenticated
 * user.
 *
 * @route GET /ref/customers
 */
router.get(
  "/customers",
  requireAuth,
  asyncHandler(async (req, res) => {
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
  }),
)

// ── GET /ref/tasks ──────────────────────────────────────

/**
 * List reference tasks for the authenticated user.
 * Optionally filtered by customer query parameter.
 *
 * @route GET /ref/tasks
 */
router.get(
  "/tasks",
  requireAuth,
  asyncHandler(async (req, res) => {
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
  }),
)

// ── GET /ref/config ────────────────────────────────────

/**
 * Return synced config (tags, feature flags) for the
 * authenticated user.
 *
 * @route GET /ref/config
 */
router.get(
  "/config",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { data } = await supabase
      .from("ref_config")
      .select("config")
      .eq("user_id", req.userId)
      .maybeSingle()

    res.json(data?.config || {
      tags: [],
      github_configured: false,
    })
  }),
)

// ── PATCH /ref/config ──────────────────────────────────

/**
 * Update specific config fields. Merges into the
 * existing config JSONB. Used by the PWA to sync
 * user_name back to the desktop app.
 *
 * @route PATCH /ref/config
 */
router.patch(
  "/config",
  requireAuth,
  asyncHandler(async (req, res) => {
    const updates = req.body || {}

    const { data: existing } = await supabase
      .from("ref_config")
      .select("config")
      .eq("user_id", req.userId)
      .maybeSingle()

    const merged = {
      ...(existing?.config || {}),
      ...updates,
    }

    await supabase.from("ref_config").upsert(
      {
        user_id: req.userId,
        config: merged,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )

    res.json(merged)
  }),
)

module.exports = router
