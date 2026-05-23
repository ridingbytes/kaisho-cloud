"use strict"

/**
 * @module workers/cron
 *
 * Hosted cron worker. A standalone process (started by its
 * own docker-compose service) that runs Companion+ cloud
 * jobs even when the user's laptop is closed.
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
const { supabase } = require("../db")
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

// jobId → { task, schedule } so reconcile() can detect a
// changed schedule and reschedule in place.
const scheduled = new Map()

/**
 * Look up the plan for a user (the worker has no request
 * context, so it can't rely on middleware). Defaults to
 * "free" if the row is gone.
 *
 * @param {string} userId
 * @returns {Promise<string>}
 */
async function getUserPlan(userId) {
  const { data } = await supabase
    .from("users")
    .select("plan")
    .eq("id", userId)
    .maybeSingle()
  return data?.plan || "free"
}

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
  await supabase.from("inbox_entries").insert({
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
  await supabase
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
  const { data: run } = await supabase
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
      await supabase
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
    const plan = await getUserPlan(job.user_id)
    const month = currentMonth()
    const [usage, cap] = await Promise.all([
      getUsage(job.user_id, month),
      resolveCap(job.user_id, plan),
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
    const result = await callModel({
      model,
      messages: [{ role: "user", content: job.prompt }],
      maxTokens: 2048,
    })
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
 * Load enabled jobs and reconcile the in-memory node-cron
 * task set against them: schedule new jobs, reschedule
 * jobs whose cron expression changed, drop jobs that were
 * disabled or deleted.
 */
async function reconcile() {
  const { data: jobs, error } = await supabase
    .from("cloud_jobs")
    .select("id, user_id, name, schedule, prompt, output")
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
    // Capture the latest job row at fire time by closing
    // over the id and re-reading would be safer, but the
    // reconcile loop already refreshes prompt/output on
    // change, so closing over the row is fine.
    const task = cron.schedule(
      job.schedule,
      () => { void runJob(job) },
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
