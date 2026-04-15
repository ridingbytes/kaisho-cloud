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

module.exports = router
