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

// ── Billing schemas ─────────────────────────────────────

/**
 * POST /billing/checkout request body.
 * @type {z.ZodObject}
 */
const checkoutSchema = z.object({
  plan: z.enum(
    ["sync", "sync_ai"],
    { message: "Unknown plan" },
  ),
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
