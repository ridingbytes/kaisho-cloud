"use strict"

/**
 * @module routes/ai
 *
 * Cloud AI gateway. Proxies requests to OpenRouter
 * using a single master key owned by the platform.
 * Usage is metered per user per month in the
 * ``ai_usage`` table.
 *
 * All endpoints require a paid plan
 * (companion / pro / team).
 */

const { Router } = require("express")
const { requireAuth } = require("../middleware")
const { apiLimiter } = require("../config")
const { asyncHandler } = require("../utils/asyncHandler")
const { logger } = require("../logger")
const {
  validate,
  aiCompleteSchema,
  aiAdvisorSchema,
  aiParseBookingSchema,
  aiSummarizeSchema,
} = require("../validation")
const {
  runAdvisor,
  DEFAULT_MAX_TOKENS,
  MAX_TOKENS_LIMIT,
} = require("../ai/advisor")
const {
  MODEL_FAST,
  MODEL_DEFAULT,
  ALLOWED_MODELS,
  getBackend,
  resolveCap,
  resolveModel,
  currentMonth,
  getUsage,
  getUserOverrides,
  recordUsage,
  callModel,
  extractText,
  extractUsage,
} = require("../ai/engine")

const router = Router()

router.use(requireAuth)
router.use(apiLimiter)
// The AI gateway is open to every account. The instance-wide
// monthly token cap is enforced separately by
// requireTokenQuota below.

// ── Guard middleware ───────────────────────────────────

/**
 * Reject early when the active backend's API key is not
 * configured in env. Looks up the env-var name from
 * gateway_config so this works after a backend swap.
 */
async function requireBackendKey(req, res, next) {
  const backend = await getBackend()
  if (!backend.apiKey) {
    return res.status(503).json({
      error:
        "AI backend not configured: env var "
        + "missing for active backend",
    })
  }
  req.aiBackend = backend
  next()
}

/**
 * Reject when the user has exceeded the monthly token
 * cap. The cap is resolved per request (user override →
 * gateway_config → env fallback) so SQL changes take
 * effect within ~60s without a restart.
 *
 * Attaches ``req.aiMonth``, ``req.aiUsage``, and
 * ``req.aiCap`` for downstream handlers.
 */
async function requireTokenQuota(req, res, next) {
  const month = currentMonth()
  let usage, cap
  try {
    [usage, cap] = await Promise.all([
      getUsage(req.userId, month),
      resolveCap(req.userId),
    ])
  } catch (err) {
    // Fail closed: if we can't read usage, reject rather
    // than grant unmetered access.
    logger.error(
      { err, userId: req.userId },
      "Token quota check failed",
    )
    return res.status(503).json({
      error: "AI quota check unavailable",
    })
  }
  const total =
    usage.input_tokens + usage.output_tokens
  if (total >= cap) {
    return res.status(429).json({
      error: "Monthly AI quota exceeded",
      usage: total,
      cap,
    })
  }
  req.aiMonth = month
  req.aiUsage = usage
  req.aiCap = cap
  next()
}

/**
 * General-purpose chat completion. Metered.
 *
 * @route POST /ai/complete
 */
router.post(
  "/complete",
  validate(aiCompleteSchema),
  asyncHandler(requireBackendKey),
  asyncHandler(requireTokenQuota),
  asyncHandler(async (req, res) => {
    const month = req.aiMonth

    const {
      system, messages, max_tokens, model, mode, tools,
    } = req.body
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        error: "messages array is required",
      })
    }

    // Mode wins over an explicit ``model`` — the gateway
    // picks the upstream model itself for kaisho:* calls.
    // Resolution: per-user override → gateway_config →
    // env fallback. Legacy clients without a mode fall
    // back to the ``model`` field (still gated by
    // ALLOWED_MODELS).
    let chosen
    if (mode) {
      chosen = await resolveModel(req.userId, mode)
    } else {
      chosen = model || MODEL_DEFAULT
      if (!ALLOWED_MODELS.has(chosen)) {
        return res.status(400).json({
          error: `Model not allowed: ${chosen}`,
        })
      }
    }

    const result = await callModel({
      backend: req.aiBackend,
      plan: req.userPlan,
      model: chosen,
      system,
      messages,
      tools,
      maxTokens: Math.min(max_tokens || 4096, 8192),
    })

    const { input: inTok, output: outTok } =
      extractUsage(result)
    await recordUsage(req.userId, month, inTok, outTok)

    const msg = result.choices?.[0]?.message || {}
    const response = {
      text: msg.content || "",
      tool_calls: msg.tool_calls || null,
      finish_reason: (
        result.choices?.[0]?.finish_reason || "stop"
      ),
      usage: {
        input_tokens: inTok,
        output_tokens: outTok,
      },
    }
    res.json(response)
  }),
)

// ── POST /ai/advisor ────────────────────────────────────

/**
 * Server-side agentic advisor. Runs a tool-using loop on
 * the server (kaisho data tools + the user's connected
 * premium integrations) and returns the final answer, so
 * thin clients like the PWA get desktop-level capability
 * without driving the loop themselves. Always routed
 * through the advisor model.
 *
 * Usage is metered per round (so tokens are recorded even
 * if a later round fails), and the loop stops early once
 * cumulative usage would reach the cap.
 *
 * @route POST /ai/advisor
 */
router.post(
  "/advisor",
  validate(aiAdvisorSchema),
  asyncHandler(requireBackendKey),
  asyncHandler(requireTokenQuota),
  asyncHandler(async (req, res) => {
    const { messages, system, context, max_tokens } =
      req.body
    const model = await resolveModel(req.userId, "advisor")
    const used =
      req.aiUsage.input_tokens + req.aiUsage.output_tokens

    const maxTokens = Math.min(
      max_tokens || DEFAULT_MAX_TOKENS, MAX_TOKENS_LIMIT,
    )

    const out = await runAdvisor({
      userId: req.userId,
      plan: req.userPlan,
      backend: req.aiBackend,
      model,
      system,
      context,
      messages,
      maxTokens,
      cap: req.aiCap,
      used,
      onUsage: (input, output) =>
        recordUsage(req.userId, req.aiMonth, input, output),
    })

    res.json({
      text: out.text,
      tools_used: out.toolsUsed,
      steps: out.steps,
      usage: {
        input_tokens: out.usage.input,
        output_tokens: out.usage.output,
      },
    })
  }),
)

// ── POST /ai/parse-booking ──────────────────────────────

const PARSE_SYSTEM =
  "You are a time entry parser for the Kaisho time " +
  "tracking app. The user types a natural-language " +
  "booking description. Extract structured data and " +
  'respond with ONLY valid JSON: {"duration":"<e.g. ' +
  '1h30m>","customer":"<name or null>",' +
  '"description":"<text or empty>",' +
  '"date":"<YYYY-MM-DD or null>"}\n' +
  "If a field cannot be determined, use null or " +
  "empty string. Do not explain."

/**
 * Regex fallback for simple booking strings.
 *
 * Patterns: "2h acme", "30m maintenance", "1h30m acme
 * fix login". First word after duration is customer,
 * rest is description.
 *
 * Hoisted above the route handler that uses it for
 * top-down readability -- JS would hoist the function
 * declaration anyway but the visual order matched the
 * runtime order.
 *
 * @param {string} text - Raw user input.
 * @returns {object|null} Parsed booking or null.
 */
function parseSimpleBooking(text) {
  const pattern =
    /^(\d+(?:\.\d+)?h(?:\d+m)?|\d+m)\s+(.+)$/i
  const m = text.trim().match(pattern)
  if (!m) return null
  const duration = m[1]
  const parts = m[2].trim().split(/\s+/)
  return {
    duration,
    customer: parts[0] || null,
    description: parts.slice(1).join(" ") || "",
    date: null,
  }
}


/**
 * Parse a natural-language booking into structured
 * fields. Uses a regex fallback for simple patterns
 * like "2h acme" to save an API call.
 *
 * @route POST /ai/parse-booking
 */
router.post(
  "/parse-booking",
  validate(aiParseBookingSchema),
  asyncHandler(async (req, res, next) => {
    const { text } = req.body
    if (!text) {
      return res.status(400).json({
        error: "text is required",
      })
    }

    // Regex fallback: catches "2h acme fix login" etc.
    // Avoids an API call for the most common patterns.
    const simple = parseSimpleBooking(text)
    if (simple) {
      return res.json({
        parsed: simple, source: "regex",
      })
    }

    next()
  }),
  asyncHandler(requireBackendKey),
  asyncHandler(requireTokenQuota),
  asyncHandler(async (req, res) => {
    const { text: input } = req.body
    const month = req.aiMonth

    // Use the fast/cheap model for structured
    // extraction — no need for a large LLM here.
    const result = await callModel({
      plan: req.userPlan,
      model: MODEL_FAST,
      system: PARSE_SYSTEM,
      messages: [{ role: "user", content: input }],
      maxTokens: 256,
    })

    const { input: inTok, output: outTok } =
      extractUsage(result)
    await recordUsage(req.userId, month, inTok, outTok)

    let parsed
    try {
      parsed = JSON.parse(extractText(result) || "{}")
    } catch {
      parsed = { duration: null, customer: null }
    }

    res.json({ parsed, source: "ai" })
  }),
)

// ── POST /ai/summarize ──────────────────────────────────

const SUMMARY_SYSTEM =
  "You are a time tracking analyst for the Kaisho " +
  "app. Given a list of time entries (JSON), produce " +
  "a short, friendly 3-4 sentence summary. Mention " +
  "total hours, busiest day, top customer, and any " +
  "notable patterns. Be concise. No markdown. No " +
  "bullet points. Plain text only."

/**
 * Generate a natural-language summary of clock entries.
 *
 * @route POST /ai/summarize
 */
router.post(
  "/summarize",
  validate(aiSummarizeSchema),
  asyncHandler(async (req, res, next) => {
    const { entries } = req.body
    if (!entries || !Array.isArray(entries)) {
      return res.status(400).json({
        error: "entries array is required",
      })
    }
    next()
  }),
  asyncHandler(requireBackendKey),
  asyncHandler(requireTokenQuota),
  asyncHandler(async (req, res) => {
    const { entries } = req.body
    const month = req.aiMonth

    // Compact representation to save tokens.
    const compact = entries.map((e) => ({
      d: e.start?.slice(0, 10),
      c: e.customer,
      m: e.duration_minutes,
      t: e.description,
    }))

    const result = await callModel({
      plan: req.userPlan,
      model: MODEL_DEFAULT,
      system: SUMMARY_SYSTEM,
      messages: [{
        role: "user",
        content: JSON.stringify(compact),
      }],
      maxTokens: 512,
    })

    const { input: inTok, output: outTok } =
      extractUsage(result)
    await recordUsage(req.userId, month, inTok, outTok)

    res.json({ summary: extractText(result) })
  }),
)

// ── GET /ai/usage ───────────────────────────────────────

/**
 * Current month's AI usage for the authenticated user.
 *
 * @route GET /ai/usage
 */
router.get(
  "/usage",
  asyncHandler(async (req, res) => {
    const month = currentMonth()
    const [usage, cap, overrides] = await Promise.all([
      getUsage(req.userId, month),
      // Pass the plan so the cap reflects the per-plan
      // quota + bonus, not the gateway_config fallback.
      resolveCap(req.userId),
      getUserOverrides(req.userId),
    ])
    res.json({
      month,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      total_tokens:
        usage.input_tokens + usage.output_tokens,
      request_count: usage.request_count,
      cap,
      bonus_tokens_remaining:
        overrides.bonus_tokens_remaining || 0,
    })
  }),
)

module.exports = router
