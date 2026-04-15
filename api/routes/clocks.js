"use strict"

/**
 * Clock entry routes — start, stop, book, list, update,
 * and delete time entries.
 */

const { Router } = require("express")
const { supabase } = require("../db")
const { requireAuth, requirePlan } = require("../middleware")
const { apiLimiter } = require("../config")
const {
  validate,
  validateQuery,
  clockStartSchema,
  quickBookSchema,
  clockUpdateSchema,
  periodQuerySchema,
} = require("../validation")
const { asyncHandler } = require("../utils/asyncHandler")
const {
  parseDuration, periodRange, formatEntry,
} = require("../utils/clocks")
const { buildUpdates } = require("../utils/updates")

const router = Router()

router.use(requireAuth)
router.use(apiLimiter)
router.use(requirePlan("sync", "sync_ai"))

// ── GET /clocks/active ──────────────────────────────────

/**
 * Return the currently running timer for the
 * authenticated user, or { active: false }.
 *
 * @route GET /clocks/active
 */
router.get(
  "/active",
  asyncHandler(async (req, res) => {
    const { data: row } = await supabase
      .from("clock_entries")
      .select("*")
      .eq("user_id", req.userId)
      .is("end_at", null)
      .single()

    if (!row) {
      return res.json({ active: false })
    }

    res.json({ active: true, ...formatEntry(row) })
  }),
)

// ── GET /clocks/entries ─────────────────────────────────

/**
 * List clock entries for a given period.
 *
 * @route GET /clocks/entries?period=today|week|month|year
 */
router.get(
  "/entries",
  validateQuery(periodQuerySchema),
  asyncHandler(async (req, res) => {
    const period = req.query.period || "today"
    const { from } = periodRange(period)

    let query = supabase
      .from("clock_entries")
      .select("*")
      .eq("user_id", req.userId)
      .gte("start_at", from.toISOString())
      .order("start_at", { ascending: false })
      .limit(200)

    if (req.query.synced === "false") {
      query = query.eq("synced", false)
    }

    const { data: rows, error } = await query
    if (error) {
      return res
        .status(500)
        .json({ error: "Failed to fetch entries" })
    }

    res.json(rows.map(formatEntry))
  }),
)

// ── POST /clocks/start ──────────────────────────────────

/**
 * Start a new timer. Fails if one is already running.
 *
 * @route POST /clocks/start
 */
router.post(
  "/start",
  validate(clockStartSchema),
  asyncHandler(async (req, res) => {
    const { customer, description, task_id, contract } =
      req.body

    const { data: active } = await supabase
      .from("clock_entries")
      .select("id")
      .eq("user_id", req.userId)
      .is("end_at", null)
      .single()

    if (active) {
      return res
        .status(409)
        .json({ error: "A timer is already running" })
    }

    const { data: row, error } = await supabase
      .from("clock_entries")
      .insert({
        user_id: req.userId,
        customer: customer || null,
        description: description || "",
        start_at: new Date().toISOString(),
        task_id: task_id || null,
        contract: contract || null,
      })
      .select()
      .single()

    if (error) {
      return res
        .status(500)
        .json({ error: "Failed to start timer" })
    }

    res.status(201).json(formatEntry(row))
  }),
)

// ── POST /clocks/stop ───────────────────────────────────

/**
 * Stop the currently running timer.
 *
 * @route POST /clocks/stop
 */
router.post(
  "/stop",
  asyncHandler(async (req, res) => {
    const { data: active } = await supabase
      .from("clock_entries")
      .select("*")
      .eq("user_id", req.userId)
      .is("end_at", null)
      .single()

    if (!active) {
      return res
        .status(404)
        .json({ error: "No running timer" })
    }

    const now = new Date().toISOString()
    const { data: row, error } = await supabase
      .from("clock_entries")
      .update({ end_at: now, updated_at: now })
      .eq("id", active.id)
      .select()
      .single()

    if (error) {
      return res
        .status(500)
        .json({ error: "Failed to stop timer" })
    }

    res.json(formatEntry(row))
  }),
)

// ── POST /clocks/quick-book ─────────────────────────────

/**
 * Book a completed time entry with a duration string.
 *
 * @route POST /clocks/quick-book
 */
router.post(
  "/quick-book",
  validate(quickBookSchema),
  asyncHandler(async (req, res) => {
    const {
      duration, customer, description,
      task_id, contract, date,
    } = req.body

    const minutes = parseDuration(duration)
    if (minutes === null || minutes <= 0) {
      return res.status(400).json({
        error: `Invalid duration: ${duration}`,
      })
    }

    let startAt
    if (date) {
      startAt = new Date(`${date}T12:00:00`)
    } else {
      startAt = new Date()
      startAt.setMinutes(
        startAt.getMinutes() - minutes,
      )
    }
    const endAt = new Date(
      startAt.getTime() + minutes * 60000,
    )

    const { data: row, error } = await supabase
      .from("clock_entries")
      .insert({
        user_id: req.userId,
        customer: customer || null,
        description: description || "",
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        task_id: task_id || null,
        contract: contract || null,
      })
      .select()
      .single()

    if (error) {
      return res
        .status(500)
        .json({ error: "Failed to book entry" })
    }

    res.status(201).json(formatEntry(row))
  }),
)

// ── PATCH /clocks/:id ───────────────────────────────────

const CLOCK_UPDATE_FIELDS = [
  "customer", "description", "task_id",
  "contract", "notes", "booked",
]

/**
 * Update fields on a clock entry.
 *
 * @route PATCH /clocks/:id
 */
router.patch(
  "/:id",
  validate(clockUpdateSchema),
  asyncHandler(async (req, res) => {
    const updates = buildUpdates(
      req.body, CLOCK_UPDATE_FIELDS,
    )
    updates.updated_at = new Date().toISOString()

    const { data: row, error } = await supabase
      .from("clock_entries")
      .update(updates)
      .eq("id", req.params.id)
      .eq("user_id", req.userId)
      .select()
      .single()

    if (error || !row) {
      return res
        .status(404)
        .json({ error: "Entry not found" })
    }

    res.json(formatEntry(row))
  }),
)

// ── DELETE /clocks/:id ──────────────────────────────────

/**
 * Delete a clock entry by ID.
 *
 * @route DELETE /clocks/:id
 */
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const { error } = await supabase
      .from("clock_entries")
      .delete()
      .eq("id", req.params.id)
      .eq("user_id", req.userId)

    if (error) {
      return res
        .status(404)
        .json({ error: "Entry not found" })
    }

    res.sendStatus(204)
  }),
)

module.exports = router
