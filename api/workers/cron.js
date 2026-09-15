"use strict"

/**
 * @module workers/cron
 *
 * Hosted cron worker. A standalone process (started by its
 * own docker-compose service) that runs cloud jobs even
 * when the user's laptop is closed.
 *
 * Loop:
 *   1. Every RECONCILE_MS, load enabled cloud_jobs and
 *      (re)schedule a node-cron task per job. Tasks for
 *      jobs that were disabled/deleted/rescheduled are
 *      torn down.
 *   2. When a task fires, runJob() records a cloud_job_runs
 *      row, checks the user's token quota, calls the AI
 *      gateway with the job prompt (metered against the
 *      same ai_usage table as the HTTP gateway), writes
 *      the output to the job's sink, and stamps the job's
 *      last_run_at / last_status.
 *
 * Schedules are evaluated in UTC. node-cron is the parsing
 * authority; the API only does loose 5-field validation.
 */

const cron = require("node-cron")
const { randomUUID } = require("crypto")
const { db } = require("../db")
const { logger } = require("../logger")
const {
  resolveCap,
  resolveModel,
  currentMonth,
  getUsage,
  recordUsage,
  callModel,
  extractText,
  extractUsage,
} = require("../ai/engine")

const RECONCILE_MS = 60_000

// cron_health is a singleton row -- one heartbeat record
// per worker process, addressed by the synthetic id 1.
// See migration 019_cron_health.sql.
const CRON_HEALTH_ID = 1

// jobId → { task, schedule } so reconcile() can detect a
// changed schedule and reschedule in place.
const scheduled = new Map()

// Job ids with a run currently in flight. node-cron does
// not prevent a new fire from overlapping a still-running
// one, so we guard here: a job that is still running when
// its next tick arrives skips that tick rather than
// stampeding itself (double-metering, double output).
const inFlight = new Set()

/**
 * Write a job's output to its sink. Today only "inbox" is
 * supported; unknown sinks fall back to inbox so output is
 * never silently dropped.
 *
 * @param {object} job - cloud_jobs row.
 * @param {string} text - AI output.
 */
async function writeOutput(job, text) {
  const now = new Date().toISOString()
  await db.from("inbox_entries").insert({
    id: randomUUID(),
    user_id: job.user_id,
    type: "NOTE",
    customer: "",
    title: `[cron] ${job.name}`,
    body: text,
    channel: "cron",
    direction: "in",
    created_at: now,
    updated_at: now,
    deleted_at: null,
  })
}

/**
 * Mark a job's last run summary on the cloud_jobs row.
 *
 * @param {string} jobId
 * @param {string} status
 */
async function stampJob(jobId, status) {
  await db
    .from("cloud_jobs")
    .update({
      last_run_at: new Date().toISOString(),
      last_status: status,
    })
    .eq("id", jobId)
}

/**
 * Execute one job: quota check → model call → output →
 * ledger + job stamp. Errors are caught and recorded; a
 * single failing job never crashes the worker.
 *
 * @param {object} job - cloud_jobs row.
 */
async function runJob(job) {
  const { data: run } = await db
    .from("cloud_job_runs")
    .insert({
      id: randomUUID(),
      job_id: job.id,
      user_id: job.user_id,
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single()
  const runId = run?.id

  const finish = async (fields) => {
    if (runId) {
      await db
        .from("cloud_job_runs")
        .update({
          ...fields,
          finished_at: new Date().toISOString(),
        })
        .eq("id", runId)
    }
    await stampJob(job.id, fields.status)
  }

  try {
    const month = currentMonth()
    const [usage, cap] = await Promise.all([
      getUsage(job.user_id, month),
      resolveCap(job.user_id),
    ])
    const used = usage.input_tokens + usage.output_tokens
    if (used >= cap) {
      logger.warn(
        { job: job.id, user_id: job.user_id, used, cap },
        "cron job skipped: quota exceeded",
      )
      return finish({
        status: "error",
        error: "Monthly AI quota exceeded",
      })
    }

    const model = await resolveModel(job.user_id, "cron")
    // Abort the model call if it outruns the job's timeout
    // so a hung request can't pin the in-flight slot (and
    // block every future tick) indefinitely.
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(),
      (job.timeout || 600) * 1000,
    )
    let result
    try {
      result = await callModel({
        model,
        messages: [{ role: "user", content: job.prompt }],
        maxTokens: 2048,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
    const text = extractText(result)
    const { input, output } = extractUsage(result)
    await recordUsage(job.user_id, month, input, output)
    await writeOutput(job, text)

    logger.info(
      {
        job: job.id,
        user_id: job.user_id,
        model,
        tokens: input + output,
      },
      "cron job completed",
    )
    return finish({
      status: "success",
      model,
      tokens_used: input + output,
      output: text,
    })
  } catch (err) {
    logger.error(
      { err, job: job.id, user_id: job.user_id },
      "cron job failed",
    )
    return finish({
      status: "error",
      error: String(err.message || err),
    })
  }
}

/**
 * Fire a scheduled tick for a job: skip if a previous run
 * is still in flight (overlap guard), otherwise re-read
 * the job fresh and run it.
 *
 * Re-reading is what makes a PATCHed prompt / output /
 * timeout take effect without a worker restart — only the
 * cron expression is fixed at schedule time (reconcile
 * reschedules when that changes). It also drops the tick
 * cleanly if the job was disabled or deleted between the
 * tick firing and this read.
 *
 * @param {string} jobId
 */
async function fireJob(jobId) {
  if (inFlight.has(jobId)) {
    logger.warn(
      { job: jobId },
      "cron job still running, skipping this tick",
    )
    return
  }
  inFlight.add(jobId)
  try {
    const { data: job } = await db
      .from("cloud_jobs")
      .select("*")
      .eq("id", jobId)
      .eq("enabled", true)
      .maybeSingle()
    if (!job) return
    await runJob(job)
  } finally {
    inFlight.delete(jobId)
  }
}

/**
 * Tear down a scheduled task for a job id.
 *
 * @param {string} jobId
 */
function unschedule(jobId) {
  const entry = scheduled.get(jobId)
  if (entry) {
    entry.task.stop()
    scheduled.delete(jobId)
  }
}

/**
 * Bump the cron_health heartbeat row so an operator can
 * detect a stuck or crashed worker by looking at
 * last_reconcile_at. Best-effort: a write failure logs
 * but does not abort the reconcile (a transient DB blip
 * should not knock the worker out of its loop).
 *
 * Uses upsert so a fresh database (or a missing health
 * row from manual cleanup) self-heals on the first tick
 * instead of silently no-op-ing forever.
 */
async function bumpHeartbeat() {
  const { error } = await db
    .from("cron_health")
    .upsert({
      id: CRON_HEALTH_ID,
      last_reconcile_at: new Date().toISOString(),
      reconcile_count: scheduled.size,
    })
  if (error) {
    logger.warn(
      { err: error.message },
      "cron heartbeat update failed",
    )
  }
}

/**
 * Load enabled jobs and reconcile the in-memory node-cron
 * task set against them: schedule new jobs, reschedule
 * jobs whose cron expression changed, drop jobs that were
 * disabled or deleted.
 */
async function reconcile() {
  // Only id + schedule are needed here; fireJob re-reads
  // the full row at fire time.
  const { data: jobs, error } = await db
    .from("cloud_jobs")
    .select("id, schedule")
    .eq("enabled", true)
  if (error) {
    logger.error({ error }, "cron reconcile: load failed")
    return
  }

  const seen = new Set()
  for (const job of jobs || []) {
    seen.add(job.id)
    const existing = scheduled.get(job.id)
    if (existing && existing.schedule === job.schedule) {
      continue
    }
    if (existing) unschedule(job.id)

    if (!cron.validate(job.schedule)) {
      logger.warn(
        { job: job.id, schedule: job.schedule },
        "cron reconcile: invalid schedule, skipping",
      )
      continue
    }
    // Close over the id only; fireJob re-reads the row at
    // fire time so prompt/output/timeout edits are picked
    // up without a restart.
    const task = cron.schedule(
      job.schedule,
      () => { void fireJob(job.id) },
      { timezone: "UTC" },
    )
    scheduled.set(job.id, { task, schedule: job.schedule })
  }

  // Drop tasks whose job is no longer enabled/present.
  for (const jobId of [...scheduled.keys()]) {
    if (!seen.has(jobId)) unschedule(jobId)
  }

  logger.info(
    { active: scheduled.size },
    "cron reconcile complete",
  )
  await bumpHeartbeat()
}

function shutdown() {
  logger.info("cron worker shutting down")
  for (const jobId of [...scheduled.keys()]) {
    unschedule(jobId)
  }
  process.exit(0)
}

async function main() {
  logger.info("cron worker starting")
  await reconcile()
  setInterval(() => { void reconcile() }, RECONCILE_MS)
  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)
}

main().catch((err) => {
  logger.error({ err }, "cron worker fatal")
  process.exit(1)
})
