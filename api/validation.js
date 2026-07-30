"use strict"

/**
 * @module validation
 *
 * Request validation schemas (Zod) and middleware
 * factories for body and query-string validation.
 * Each schema documents which endpoint consumes it.
 */

const { z } = require("zod")

// ── Auth schemas ────────────────────────────────────────

const emailSchema = z
  .string()
  .email("Invalid email address")

/**
 * POST /auth/signup request body.
 * @type {z.ZodObject}
 */
const signupSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(8, "Password must be at least 8 characters"),
})

/**
 * POST /auth/login request body.
 * @type {z.ZodObject}
 */
const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
})

/**
 * POST /auth/rotate-key request body.
 * @type {z.ZodObject}
 */
const rotateKeySchema = z.object({
  email: emailSchema,
})

/**
 * POST /auth/refresh request body.
 * @type {z.ZodObject}
 */
const refreshSchema = z.object({
  refresh_token: z
    .string()
    .min(1, "refresh_token is required"),
})

// ── Clock schemas ───────────────────────────────────────

/**
 * POST /clocks/start request body.
 * @type {z.ZodObject}
 */
const clockStartSchema = z.object({
  customer: z.string().nullable().optional(),
  description: z.string().optional().default(""),
  task_id: z.string().nullable().optional(),
  contract: z.string().nullable().optional(),
  project: z.string().nullable().optional(),
})

/**
 * POST /clocks/quick-book request body.
 * @type {z.ZodObject}
 */
const quickBookSchema = z.object({
  duration: z.string().min(1, "Duration is required"),
  customer: z.string().nullable().optional(),
  description: z.string().optional().default(""),
  task_id: z.string().nullable().optional(),
  contract: z.string().nullable().optional(),
  project: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
})

/**
 * PATCH /clocks/:id request body. At least one field
 * must be present (enforced by the refine check).
 * @type {z.ZodObject}
 */
const clockUpdateSchema = z.object({
  customer: z.string().nullable().optional(),
  description: z.string().optional(),
  task_id: z.string().nullable().optional(),
  contract: z.string().nullable().optional(),
  project: z.string().nullable().optional(),
  notes: z.string().optional(),
  invoiced: z.boolean().optional(),
  start_at: z.string().optional(),
  end_at: z.string().nullable().optional(),
}).refine(
  (d) => Object.values(d).some((v) => v !== undefined),
  { message: "Nothing to update" },
)

// ── Sync schemas ────────────────────────────────────────

/**
 * POST /sync/push-snapshot request body. Replaces all
 * reference customers and tasks for the user.
 * @type {z.ZodObject}
 */
const snapshotSchema = z.object({
  customers: z.array(z.object({
    name: z.string(),
    contracts: z.array(z.object({
      name: z.string(),
      budget: z.number().optional(),
      start_date: z.string().optional(),
    })).optional().default([]),
  })),
  tasks: z.array(z.object({
    id: z.string(),
    customer: z.string().nullable().optional(),
    title: z.string(),
    status: z.string(),
  })),
  config: z.object({
    tags: z.array(z.object({
      name: z.string(),
      color: z.string().optional().default(""),
    })).optional().default([]),
    // The desktop's org TODO keywords with their display
    // label, kanban colour, and done-flag. Lets the PWA
    // render the user's actual statuses instead of guessing.
    task_states: z.array(z.object({
      name: z.string(),
      label: z.string().optional().default(""),
      color: z.string().optional().default(""),
      done: z.boolean().optional().default(false),
    })).optional().default([]),
    github_configured: z.boolean()
      .optional().default(false),
    avatar_seed: z.string().optional().default(""),
    avatar_style: z.string().optional().default(""),
    user_name: z.string().optional().default(""),
  }).optional(),
  snapshot_at: z.string().optional(),
})

// ── Bidirectional sync schemas ──────────────────────────

/**
 * One entry in a POST /sync/apply batch. The `id` field
 * is the shared sync UUID; `deleted_at` marks a
 * tombstone (soft-delete propagation).
 * @type {z.ZodObject}
 */
const syncEntrySchema = z.object({
  id: z.string().uuid(),
  customer: z.string().nullable().optional(),
  description: z.string().optional().default(""),
  start: z.string().min(1),
  end: z.string().nullable().optional(),
  task_id: z.string().nullable().optional(),
  contract: z.string().nullable().optional(),
  project: z.string().nullable().optional(),
  notes: z.string().optional().default(""),
  invoiced: z.boolean().optional().default(false),
  updated_at: z.string().min(1),
  deleted_at: z.string().nullable().optional(),
})

/**
 * POST /sync/apply request body. Accepts up to 500
 * entries per batch.
 * @type {z.ZodObject}
 */
const syncApplySchema = z.object({
  entries: z.array(syncEntrySchema).max(500),
})

/**
 * POST /sync/active/start request body.
 * @type {z.ZodObject}
 */
const activeStartSchema = z.object({
  id: z.string().uuid(),
  customer: z.string().nullable().optional(),
  description: z.string().optional().default(""),
  task_id: z.string().nullable().optional(),
  contract: z.string().nullable().optional(),
  start: z.string().min(1),
})

/**
 * POST /sync/active/stop request body.
 * @type {z.ZodObject}
 */
const activeStopSchema = z.object({
  id: z.string().uuid().optional(),
  end: z.string().min(1).optional(),
})

// ── Inbox sync schemas ─────────────────────────────

/**
 * One entry in a POST /sync/inbox/apply batch.
 * @type {z.ZodObject}
 */
const inboxEntrySchema = z.object({
  id: z.string(),
  type: z.string(),
  customer: z.string(),
  title: z.string(),
  body: z.string(),
  channel: z.string(),
  direction: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable().optional(),
})

/**
 * POST /sync/inbox/apply request body.
 * @type {z.ZodObject}
 */
const inboxApplySchema = z.object({
  entries: z.array(inboxEntrySchema).max(500),
})

// ── Task sync schemas ──────────────────────────────

/**
 * One entry in a POST /sync/tasks/apply batch.
 * @type {z.ZodObject}
 */
const taskEntrySchema = z.object({
  id: z.string(),
  customer: z.string(),
  title: z.string(),
  status: z.string(),
  tags: z.array(z.string()),
  body: z.string(),
  github_url: z.string(),
  project: z.string().nullable().optional(),
  milestone: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable().optional(),
})

/**
 * POST /sync/tasks/apply request body.
 * @type {z.ZodObject}
 */
const taskApplySchema = z.object({
  entries: z.array(taskEntrySchema).max(500),
})

// ── Note sync schemas ──────────────────────────────
//
// Note on id types across the sync schemas: clock_entries
// and inbox_entries use UUID primary keys (z.string().uuid()
// in syncEntrySchema / activeStartSchema). Tasks and notes
// use org-mode-style TEXT ids (e.g. "task-202401-001") so
// taskEntrySchema and noteEntrySchema use plain z.string().
// See migrations 007_tasks.sql and 008_notes.sql.

/**
 * One entry in a POST /sync/notes/apply batch.
 * @type {z.ZodObject}
 */
const noteEntrySchema = z.object({
  id: z.string(),
  customer: z.string(),
  title: z.string(),
  body: z.string(),
  tags: z.array(z.string()),
  // .nullable().optional() to match task_id everywhere
  // else in this file — a missing key and an explicit
  // null both mean "note not linked to a task".
  task_id: z.string().nullable().optional(),
  project: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable().optional(),
})

/**
 * POST /sync/notes/apply request body.
 * @type {z.ZodObject}
 */
const noteApplySchema = z.object({
  entries: z.array(noteEntrySchema).max(500),
})

// ── Project sync schemas ───────────────────────────────
//
// Projects use org-mode-style TEXT ids ("P-ab12cd34") like
// tasks and notes, so the id is a plain z.string(). Dates
// are plain YYYY-MM-DD strings. Milestones ride inline as
// an array of small objects (see migration 021).

/**
 * One milestone inside a project. `done` toggles the
 * org TODO/DONE keyword on the desktop; `due` is an
 * optional YYYY-MM-DD date.
 * @type {z.ZodObject}
 */
const milestoneSchema = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean().optional().default(false),
  due: z.string().nullable().optional(),
})

/**
 * One entry in a POST /sync/projects/apply batch.
 * @type {z.ZodObject}
 */
const projectEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  customer: z.string().optional().default(""),
  status: z.string().optional().default("ACTIVE"),
  contract: z.string().nullable().optional(),
  start: z.string().nullable().optional(),
  due: z.string().nullable().optional(),
  color: z.string().optional().default(""),
  tags: z.array(z.string()).optional().default([]),
  description: z.string().optional().default(""),
  milestones: z.array(milestoneSchema).optional().default([]),
  created_at: z.string().optional(),
  updated_at: z.string().min(1),
  deleted_at: z.string().nullable().optional(),
})

/**
 * POST /sync/projects/apply request body.
 * @type {z.ZodObject}
 */
const projectApplySchema = z.object({
  entries: z.array(projectEntrySchema).max(500),
})

// ── Query schemas ───────────────────────────────────────

/**
 * GET /clocks/entries query parameters.
 * @type {z.ZodObject}
 */
const periodQuerySchema = z.object({
  period: z
    .enum(["today", "week", "month", "year"])
    .optional(),
  from: z.string().optional(),
  to: z.string().optional(),
})

/**
 * GET /sync/changes query parameters.
 * @type {z.ZodObject}
 */
const syncChangesQuerySchema = z.object({
  since: z.string().optional(),
  limit: z.coerce.number().int().positive().optional(),
})

// ── AI schemas ─────────────────────────────────────────

/**
 * POST /ai/complete request body.
 * @type {z.ZodObject}
 */
const aiCompleteSchema = z.object({
  system: z.string().optional(),
  messages: z.array(z.any()),
  max_tokens: z.number().optional(),
  // Mode picks the upstream model server-side. The
  // legacy ``model`` field is still accepted for
  // pre-1.2.0 clients but newer clients send ``mode``.
  mode: z.enum([
    "advisor", "cron", "default",
  ]).optional(),
  model: z.string().optional(),
  tools: z.array(z.any()).optional(),
})

/**
 * Server-side agentic advisor request. The loop builds
 * the toolset itself, so clients send only the
 * conversation, an optional system override and an
 * optional context block (e.g. the user's local time).
 *
 * @type {z.ZodObject}
 */
const aiAdvisorSchema = z.object({
  messages: z.array(z.any()).min(1),
  system: z.string().optional(),
  context: z.string().optional(),
  max_tokens: z.number().optional(),
})

/**
 * POST /ai/parse-booking request body.
 * @type {z.ZodObject}
 */
const aiParseBookingSchema = z.object({
  text: z.string().min(1, "text is required"),
})

/**
 * POST /ai/summarize request body.
 * @type {z.ZodObject}
 */
const aiSummarizeSchema = z.object({
  entries: z.array(z.any()),
  period: z.string().optional(),
})

// ── Middleware factories ─────────────────────────────────

/**
 * Create body-validation middleware for a Zod schema.
 *
 * @param {z.ZodSchema} schema - Zod schema for
 *   req.body.
 * @returns {Function} Express middleware.
 */
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      const msg =
        result.error.issues[0]?.message ||
        "Invalid request body"
      return res.status(400).json({ error: msg })
    }
    req.body = result.data
    next()
  }
}

/**
 * Create query-validation middleware for a Zod schema.
 *
 * @param {z.ZodSchema} schema - Zod schema for
 *   req.query.
 * @returns {Function} Express middleware.
 */
function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query)
    if (!result.success) {
      const msg =
        result.error.issues[0]?.message ||
        "Invalid query parameters"
      return res.status(400).json({ error: msg })
    }
    req.query = result.data
    next()
  }
}

// ── Cloud cron job schemas ──────────────────────────────

// A standard 5-field cron expression. Loose validation
// here (5 whitespace-separated fields); the worker's
// node-cron parser is the authority and rejects malformed
// fields at scheduling time.
const cronScheduleSchema = z
  .string()
  .trim()
  .regex(
    /^(\S+\s+){4}\S+$/,
    "Schedule must be a 5-field cron expression",
  )

/**
 * POST /cloud/jobs request body.
 * @type {z.ZodObject}
 */
const cloudJobCreateSchema = z.object({
  name: z.string().min(1).max(200),
  schedule: cronScheduleSchema,
  prompt: z.string().min(1).max(100_000),
  model: z.string().max(200).optional(),
  output: z.string().max(50).optional(),
  timeout: z.number().int().positive().max(3600).optional(),
  enabled: z.boolean().optional(),
})

/**
 * PATCH /cloud/jobs/:id request body. All optional.
 * @type {z.ZodObject}
 */
const cloudJobUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  schedule: cronScheduleSchema.optional(),
  prompt: z.string().min(1).max(100_000).optional(),
  model: z.string().max(200).optional(),
  output: z.string().max(50).optional(),
  timeout: z.number().int().positive().max(3600).optional(),
  enabled: z.boolean().optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: "No fields to update" },
)

/**
 * POST /integrations/:kind request body. API-key / PAT
 * based providers (Linear, GitHub) send their token here.
 * @type {z.ZodObject}
 */
const integrationConnectSchema = z.object({
  api_key: z.string().min(1, "api_key is required"),
})

/**
 * POST /integrations/dispatch request body. Runs one
 * integration tool for the user (used by the desktop
 * advisor).
 * @type {z.ZodObject}
 */
const integrationDispatchSchema = z.object({
  kind: z.string().min(1),
  tool: z.string().min(1),
  args: z.record(z.unknown()).optional(),
})

module.exports = {
  signupSchema,
  loginSchema,
  rotateKeySchema,
  refreshSchema,
  cloudJobCreateSchema,
  cloudJobUpdateSchema,
  integrationConnectSchema,
  integrationDispatchSchema,
  clockStartSchema,
  quickBookSchema,
  clockUpdateSchema,
  snapshotSchema,
  syncEntrySchema,
  syncApplySchema,
  inboxEntrySchema,
  inboxApplySchema,
  taskEntrySchema,
  taskApplySchema,
  noteEntrySchema,
  noteApplySchema,
  projectEntrySchema,
  projectApplySchema,
  activeStartSchema,
  activeStopSchema,
  periodQuerySchema,
  syncChangesQuerySchema,
  aiCompleteSchema,
  aiAdvisorSchema,
  aiParseBookingSchema,
  aiSummarizeSchema,
  validate,
  validateQuery,
}
