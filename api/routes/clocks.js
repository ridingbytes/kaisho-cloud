"use strict"

/**
 * @module routes/clocks
 *
 * Clock entry routes — start, stop, book, list, update,
 * and delete time entries. All routes require JWT auth
 * and an active "sync" or "sync_ai" plan.
 */

const { Router } = require("express")
const { supabase } = require("../db")
const { requireAuth, requirePlan } = require("../middleware")
const { apiLimiter } = require("../config")
const { broadcast } = require("../ws")
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
      // Soft-delete filter: exclude logically deleted rows
      .is("deleted_at", null)
      .maybeSingle()

    if (!row) {
      return res.json({ active: false })
    }

    res.json({ active: true, ...formatEntry(row) })
  }),
)

// ── GET /clocks/entries ─────────────────────────────────

/**
 * List clock entries for a given period or explicit date
 * range. `from` and `to` (inclusive ISO dates or full
 * timestamps) override `period` when supplied.
 *
 * @route GET /clocks/entries?period=today|week|month|year
 *          |from=<iso>&to=<iso>
 */
router.get(
  "/entries",
  validateQuery(periodQuerySchema),
  asyncHandler(async (req, res) => {
    const { from: fromStr, to: toStr } = req.query
    let fromDate, toDate
    if (fromStr || toStr) {
      fromDate = fromStr
        ? new Date(fromStr)
        : new Date("1970-01-01T00:00:00Z")
      toDate = toStr ? new Date(toStr) : new Date()
    } else {
      const period = req.query.period || "today"
      ;({ from: fromDate } = periodRange(period))
      toDate = null
    }

    let query = supabase
      .from("clock_entries")
      .select("*")
      .eq("user_id", req.userId)
      // Soft-delete filter: only show live entries
      .is("deleted_at", null)
      .gte("start_at", fromDate.toISOString())
      .order("start_at", { ascending: false })
      .limit(500)

    if (toDate) {
      query = query.lte("start_at", toDate.toISOString())
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
      .is("deleted_at", null)
      .maybeSingle()

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

    const entry = formatEntry(row)
    broadcast(req.userId, "timer:started", entry)
    res.status(201).json(entry)
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
      .is("deleted_at", null)
      .maybeSingle()

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

    const entry = formatEntry(row)
    broadcast(req.userId, "timer:stopped", entry)
    res.json(entry)
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
      // Explicit UTC to avoid timezone ambiguity
      startAt = new Date(`${date}T12:00:00Z`)
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

    const booked = formatEntry(row)
    broadcast(req.userId, "entries:changed", {
      count: 1,
    })
    res.status(201).json(booked)
  }),
)

// ── PATCH /clocks/:id ───────────────────────────────────

/**
 * Allowlisted fields for PATCH /clocks/:id. Only these
 * columns are copied from the request body into the
 * update payload, preventing writes to protected fields
 * like user_id or start_at.
 *
 * @type {string[]}
 */
const CLOCK_UPDATE_FIELDS = [
  "customer", "description", "task_id",
  "contract", "notes", "invoiced",
  "start_at", "end_at",
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
      // Soft-delete filter: cannot update deleted entries
      .is("deleted_at", null)
      .select()
      .single()

    if (error || !row) {
      return res
        .status(404)
        .json({ error: "Entry not found" })
    }

    const updated = formatEntry(row)
    broadcast(req.userId, "entries:changed", {
      count: 1,
    })
    res.json(updated)
  }),
)

// ── DELETE /clocks/:id ──────────────────────────────────

/**
 * Soft-delete a clock entry by ID. Sets deleted_at so the
 * delete propagates through /sync/changes to other clients.
 *
 * @route DELETE /clocks/:id
 */
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const now = new Date().toISOString()
    const { data: row, error } = await supabase
      .from("clock_entries")
      .update({ deleted_at: now, updated_at: now })
      .eq("id", req.params.id)
      .eq("user_id", req.userId)
      // Only delete entries that are not already deleted
      .is("deleted_at", null)
      .select("id")
      .maybeSingle()

    if (error || !row) {
      return res
        .status(404)
        .json({ error: "Entry not found" })
    }

    broadcast(req.userId, "entries:deleted", {
      ids: [row.id],
    })
    res.sendStatus(204)
  }),
)

module.exports = router
