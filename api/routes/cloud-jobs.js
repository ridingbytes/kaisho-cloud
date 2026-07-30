"use strict"

/**
 * @module routes/cloud-jobs
 *
 * Hosted cron job CRUD. The desktop pushes a job spec here
 * when the user ticks "Run in cloud"; a separate Node
 * worker (see workers/cron.js) polls and executes due
 * jobs. All routes require auth and a paid plan
 * (companion / pro / team).
 */

const { Router } = require("express")
const { supabase } = require("../db")
const { requireAuth } = require("../middleware")
const { apiLimiter } = require("../config")
const {
  validate,
  cloudJobCreateSchema,
  cloudJobUpdateSchema,
} = require("../validation")
const { asyncHandler } = require("../utils/asyncHandler")

const router = Router()

router.use(requireAuth)
router.use(apiLimiter)

// Columns returned to the client. Excludes nothing
// sensitive today, but listing them keeps the response
// shape stable if internal columns are added later.
const JOB_COLUMNS =
  "id, name, schedule, prompt, model, output, timeout, " +
  "enabled, last_run_at, last_status, created_at, updated_at"

// ── GET /cloud/jobs ─────────────────────────────────────

/**
 * List the authenticated user's cloud jobs.
 *
 * @route GET /cloud/jobs
 */
router.get(
  "/jobs",
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from("cloud_jobs")
      .select(JOB_COLUMNS)
      .eq("user_id", req.userId)
      .order("created_at", { ascending: true })
    if (error) {
      return res
        .status(500)
        .json({ error: "Failed to list jobs" })
    }
    res.json(data || [])
  }),
)

// ── POST /cloud/jobs ────────────────────────────────────

/**
 * Create a cloud job.
 *
 * @route POST /cloud/jobs
 */
router.post(
  "/jobs",
  validate(cloudJobCreateSchema),
  asyncHandler(async (req, res) => {
    const body = req.body
    const { data, error } = await supabase
      .from("cloud_jobs")
      .insert({
        user_id: req.userId,
        name: body.name,
        schedule: body.schedule,
        prompt: body.prompt,
        model: body.model ?? "",
        output: body.output ?? "inbox",
        timeout: body.timeout ?? 600,
        enabled: body.enabled ?? true,
      })
      .select(JOB_COLUMNS)
      .single()
    if (error) {
      return res
        .status(500)
        .json({ error: "Failed to create job" })
    }
    res.status(201).json(data)
  }),
)

// ── PATCH /cloud/jobs/:id ───────────────────────────────

/**
 * Update fields on a cloud job. Only supplied fields
 * change.
 *
 * @route PATCH /cloud/jobs/:id
 */
// Columns a PATCH may touch. Copying explicitly (rather
// than spreading req.body) keeps writes confined to these
// even if the validation schema ever widens — user_id,
// last_run_at, etc. can never be reassigned via the body.
const JOB_PATCH_FIELDS = [
  "name", "schedule", "prompt", "model",
  "output", "timeout", "enabled",
]

router.patch(
  "/jobs/:id",
  validate(cloudJobUpdateSchema),
  asyncHandler(async (req, res) => {
    const updates = { updated_at: new Date().toISOString() }
    for (const field of JOB_PATCH_FIELDS) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field]
      }
    }
    const { data, error } = await supabase
      .from("cloud_jobs")
      .update(updates)
      .eq("user_id", req.userId)
      .eq("id", req.params.id)
      .select(JOB_COLUMNS)
      .maybeSingle()
    if (error) {
      return res
        .status(500)
        .json({ error: "Failed to update job" })
    }
    if (!data) {
      return res.status(404).json({ error: "Job not found" })
    }
    res.json(data)
  }),
)

// ── DELETE /cloud/jobs/:id ──────────────────────────────

/**
 * Delete a cloud job. Cascades to its run history.
 *
 * @route DELETE /cloud/jobs/:id
 */
router.delete(
  "/jobs/:id",
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from("cloud_jobs")
      .delete()
      .eq("user_id", req.userId)
      .eq("id", req.params.id)
      .select("id")
      .maybeSingle()
    if (error) {
      return res
        .status(500)
        .json({ error: "Failed to delete job" })
    }
    if (!data) {
      return res.status(404).json({ error: "Job not found" })
    }
    res.json({ deleted: data.id })
  }),
)

// ── GET /cloud/jobs/:id/runs ────────────────────────────

/**
 * List recent run history for a cloud job (newest first,
 * capped at 50).
 *
 * @route GET /cloud/jobs/:id/runs
 */
router.get(
  "/jobs/:id/runs",
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from("cloud_job_runs")
      .select(
        "id, status, model, tokens_used, output, error, " +
        "started_at, finished_at, created_at",
      )
      .eq("user_id", req.userId)
      .eq("job_id", req.params.id)
      .order("created_at", { ascending: false })
      .limit(50)
    if (error) {
      return res
        .status(500)
        .json({ error: "Failed to list runs" })
    }
    res.json(data || [])
  }),
)

module.exports = router
