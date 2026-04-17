"use strict"

/**
 * Request validation schemas (Zod) and middleware
 * factories for body and query validation.
 */

const { z } = require("zod")

// ── Auth schemas ────────────────────────────────────────

const emailSchema = z
  .string()
  .email("Invalid email address")

/** @type {z.ZodObject} Signup request body. */
const signupSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(8, "Password must be at least 8 characters"),
})

/** @type {z.ZodObject} Login request body. */
const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
})

/** @type {z.ZodObject} Key rotation request body. */
const rotateKeySchema = z.object({
  email: emailSchema,
})

/** @type {z.ZodObject} Token refresh request body. */
const refreshSchema = z.object({
  refresh_token: z
    .string()
    .min(1, "refresh_token is required"),
})

// ── Billing schemas ─────────────────────────────────────

/** @type {z.ZodObject} Checkout request body. */
const checkoutSchema = z.object({
  plan: z.enum(
    ["sync", "sync_ai"],
    { message: "Unknown plan" },
  ),
})

// ── Clock schemas ───────────────────────────────────────

/** @type {z.ZodObject} Clock start request body. */
const clockStartSchema = z.object({
  customer: z.string().nullable().optional(),
  description: z.string().optional().default(""),
  task_id: z.string().nullable().optional(),
  contract: z.string().nullable().optional(),
})

/** @type {z.ZodObject} Quick-book request body. */
const quickBookSchema = z.object({
  duration: z.string().min(1, "Duration is required"),
  customer: z.string().nullable().optional(),
  description: z.string().optional().default(""),
  task_id: z.string().nullable().optional(),
  contract: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
})

/** @type {z.ZodObject} Clock entry update body. */
const clockUpdateSchema = z.object({
  customer: z.string().nullable().optional(),
  description: z.string().optional(),
  task_id: z.string().nullable().optional(),
  contract: z.string().nullable().optional(),
  notes: z.string().optional(),
  invoiced: z.boolean().optional(),
}).refine(
  (d) =>
    d.customer !== undefined ||
    d.description !== undefined ||
    d.task_id !== undefined ||
    d.contract !== undefined ||
    d.notes !== undefined ||
    d.invoiced !== undefined,
  { message: "Nothing to update" },
)

// ── Sync schemas ────────────────────────────────────────

/** @type {z.ZodObject} Snapshot push request body. */
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
  snapshot_at: z.string().optional(),
})

// ── Bidirectional sync schemas ──────────────────────────

/**
 * @type {z.ZodObject} One entry in a POST /sync/apply
 * batch. `id` is the shared sync_id; `deleted_at` marks
 * a tombstone.
 */
const syncEntrySchema = z.object({
  id: z.string().uuid(),
  customer: z.string().nullable().optional(),
  description: z.string().optional().default(""),
  start: z.string().min(1),
  end: z.string().nullable().optional(),
  task_id: z.string().nullable().optional(),
  contract: z.string().nullable().optional(),
  notes: z.string().optional().default(""),
  invoiced: z.boolean().optional().default(false),
  updated_at: z.string().min(1),
  deleted_at: z.string().nullable().optional(),
})

/** @type {z.ZodObject} POST /sync/apply request body. */
const syncApplySchema = z.object({
  entries: z.array(syncEntrySchema).max(500),
})

/** @type {z.ZodObject} Active-timer start request. */
const activeStartSchema = z.object({
  id: z.string().uuid(),
  customer: z.string().nullable().optional(),
  description: z.string().optional().default(""),
  task_id: z.string().nullable().optional(),
  contract: z.string().nullable().optional(),
  start: z.string().min(1),
})

/** @type {z.ZodObject} Active-timer stop request. */
const activeStopSchema = z.object({
  id: z.string().uuid().optional(),
  end: z.string().min(1).optional(),
})

// ── Query schemas ───────────────────────────────────────

/** @type {z.ZodObject} Period query parameter. */
const periodQuerySchema = z.object({
  period: z
    .enum(["today", "week", "month", "year"])
    .optional(),
  from: z.string().optional(),
  to: z.string().optional(),
})

/** @type {z.ZodObject} /sync/changes query parameters. */
const syncChangesQuerySchema = z.object({
  since: z.string().optional(),
  limit: z.coerce.number().int().positive().optional(),
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

module.exports = {
  signupSchema,
  loginSchema,
  rotateKeySchema,
  refreshSchema,
  checkoutSchema,
  clockStartSchema,
  quickBookSchema,
  clockUpdateSchema,
  snapshotSchema,
  syncEntrySchema,
  syncApplySchema,
  activeStartSchema,
  activeStopSchema,
  periodQuerySchema,
  syncChangesQuerySchema,
  validate,
  validateQuery,
}
