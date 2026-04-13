"use strict"

const { Router } = require("express")
const { supabase } = require("../db")
const { requireAuth, requirePlan } = require("../middleware")
const { apiLimiter } = require("../config")
const {
  validate,
  clockStartSchema,
  quickBookSchema,
  clockUpdateSchema,
} = require("../validation")

const router = Router()

router.use(requireAuth)
router.use(apiLimiter)
router.use(requirePlan("sync", "sync_ai"))

// ── Duration parser ──────────────────────────────────────

const DURATION_SIMPLE =
  /^(\d+(?:\.\d+)?)\s*(h|hours?|m|min|mins|minutes?)$/i
const DURATION_COMPOUND =
  /^(\d+)\s*h\s*(\d+)\s*(?:m|min|mins|minutes?)?$/i

function parseDuration(str) {
  const s = str.trim().toLowerCase()
  const cm = DURATION_COMPOUND.exec(s)
  if (cm) {
    return parseInt(cm[1]) * 60 + parseInt(cm[2])
  }
  const sm = DURATION_SIMPLE.exec(s)
  if (!sm) return null
  const value = parseFloat(sm[1])
  return sm[2].startsWith("h")
    ? Math.round(value * 60)
    : Math.round(value)
}

// ── Helpers ──────────────────────────────────────────────

function formatEntry(row) {
  const durationMinutes =
    row.end_at && row.start_at
      ? Math.round(
          (new Date(row.end_at) -
            new Date(row.start_at)) /
            60000,
        )
      : null
  return {
    id: row.id,
    customer: row.customer || null,
    description: row.description,
    start: row.start_at,
    end: row.end_at || null,
    duration_minutes: durationMinutes,
    task_id: row.task_id || null,
    contract: row.contract || null,
    notes: row.notes || "",
    booked: row.booked || false,
    synced: row.synced || false,
    created_at: row.created_at,
  }
}

function periodRange(period) {
  const now = new Date()
  const today = new Date(
    now.getFullYear(), now.getMonth(), now.getDate(),
  )
  switch (period) {
    case "today":
      return { from: today }
    case "week": {
      const day = today.getDay()
      const monday = new Date(today)
      monday.setDate(today.getDate() - ((day + 6) % 7))
      return { from: monday }
    }
    case "month":
      return {
        from: new Date(
          today.getFullYear(), today.getMonth(), 1,
        ),
      }
    case "year":
      return {
        from: new Date(today.getFullYear(), 0, 1),
      }
    default:
      return { from: today }
  }
}

// ── GET /clocks/active ───────────────────────────────────

router.get("/active", async (req, res) => {
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
})

// ── GET /clocks/entries ──────────────────────────────────

router.get("/entries", async (req, res) => {
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
})

// ── POST /clocks/start ───────────────────────────────────

router.post(
  "/start",
  validate(clockStartSchema),
  async (req, res) => {
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
  },
)

// ── POST /clocks/stop ────────────────────────────────────

router.post("/stop", async (req, res) => {
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
})

// ── POST /clocks/quick-book ──────────────────────────────

router.post(
  "/quick-book",
  validate(quickBookSchema),
  async (req, res) => {
    const {
      duration, customer, description,
      task_id, contract, date,
    } = req.body

    const minutes = parseDuration(duration)
    if (minutes === null || minutes <= 0) {
      return res
        .status(400)
        .json({ error: `Invalid duration: ${duration}` })
    }

    let startAt
    if (date) {
      startAt = new Date(`${date}T12:00:00`)
    } else {
      startAt = new Date()
      startAt.setMinutes(startAt.getMinutes() - minutes)
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
  },
)

// ── PATCH /clocks/:id ────────────────────────────────────

router.patch(
  "/:id",
  validate(clockUpdateSchema),
  async (req, res) => {
    const updates = {
      updated_at: new Date().toISOString(),
    }
    if (req.body.customer !== undefined) {
      updates.customer = req.body.customer
    }
    if (req.body.description !== undefined) {
      updates.description = req.body.description
    }
    if (req.body.task_id !== undefined) {
      updates.task_id = req.body.task_id
    }
    if (req.body.contract !== undefined) {
      updates.contract = req.body.contract
    }
    if (req.body.notes !== undefined) {
      updates.notes = req.body.notes
    }
    if (req.body.booked !== undefined) {
      updates.booked = req.body.booked
    }

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
  },
)

// ── DELETE /clocks/:id ───────────────────────────────────

router.delete("/:id", async (req, res) => {
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
})

module.exports = router
