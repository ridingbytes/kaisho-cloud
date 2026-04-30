"use strict"

/**
 * @module routes/ai
 *
 * Cloud AI gateway. Proxies requests to OpenRouter
 * using a single master key owned by the platform.
 * Usage is metered per user per month in the
 * ``ai_usage`` table.
 *
 * All endpoints require the ``sync_ai`` plan.
 */

const { Router } = require("express")
const { supabase } = require("../db")
const {
  requireAuth, requirePlan,
} = require("../middleware")
const { apiLimiter } = require("../config")
const { asyncHandler } = require("../utils/asyncHandler")
const { logger } = require("../logger")
const {
  validate,
  aiCompleteSchema,
  aiParseBookingSchema,
  aiSummarizeSchema,
} = require("../validation")

const router = Router()

router.use(requireAuth)
router.use(apiLimiter)
router.use(requirePlan("sync_ai"))

// ── Config ──────────────────────────────────────────────
//
// Uses OpenRouter as the inference gateway. OpenRouter
// provides a unified OpenAI-compatible API across many
// models and handles rate limiting, fallbacks, and cost
// tracking on their side.

const OPENROUTER_API_KEY =
  process.env.OPENROUTER_API_KEY || ""
const OPENROUTER_URL =
  "https://openrouter.ai/api/v1/chat/completions"

// Model selection per use case:
//   - FAST: cheap structured extraction (parse-booking)
//   - DEFAULT: general completion + summarization
const MODEL_FAST = process.env.AI_MODEL_FAST
  || "google/gemini-2.0-flash-lite-001"
const MODEL_DEFAULT = process.env.AI_MODEL_DEFAULT
  || "anthropic/claude-sonnet-4"

// Mode → model mapping for kaisho:* requests. Clients
// pass ``mode`` on the request body; the gateway
// resolves it to a concrete upstream model server-side.
// This keeps users from proxying through expensive
// models on our dime.
//
//   - advisor: agentic loop with tool calling. Needs
//              reliable tool adherence + multi-turn
//              quality. Haiku 4.5 is the price/quality
//              sweet spot vs Sonnet's 3x premium.
//   - cron:    single-shot summarization. Gemma 4 31B is
//              ~25x cheaper than Haiku and handles the
//              workload well.
//   - default: fallback when a mode-aware client sends
//              an unrecognized mode.
const MODEL_BY_MODE = {
  advisor: process.env.AI_MODEL_ADVISOR
    || "anthropic/claude-haiku-4.5",
  cron: process.env.AI_MODEL_CRON
    || "google/gemma-4-31b-it",
  default: process.env.AI_MODEL_KAISHO_DEFAULT
    || "anthropic/claude-haiku-4.5",
}

// Models clients can request via the legacy ``model``
// field. Mode-routed requests bypass this list because
// the gateway picks the model itself.
const ALLOWED_MODELS = new Set(
  (process.env.AI_ALLOWED_MODELS || [
    MODEL_FAST,
    MODEL_DEFAULT,
    "google/gemini-2.0-flash-lite-001",
    "google/gemini-2.5-flash",
    "google/gemma-4-31b-it",
    "anthropic/claude-haiku-4.5",
    "anthropic/claude-sonnet-4.6",
  ].join(",")).split(",").map((s) => s.trim()),
)

// Monthly soft cap: 250K tokens shared across modes.
// Sized so that a single user fully utilizing Haiku for
// the advisor costs <= ~$1.10/month worst case.
// Requests over the cap return 429.
const MONTHLY_TOKEN_CAP = 250_000

// ── Guard middleware ───────────────────────────────────

/**
 * Reject early when the OpenRouter key is not configured.
 */
function requireOpenRouterKey(req, res, next) {
  if (!OPENROUTER_API_KEY) {
    return res
      .status(503)
      .json({ error: "AI not configured" })
  }
  next()
}

/**
 * Reject when the user has exceeded the monthly token
 * cap. Attaches ``req.aiMonth`` and ``req.aiUsage`` for
 * downstream handlers.
 */
async function requireTokenQuota(req, res, next) {
  const month = currentMonth()
  const usage = await getUsage(req.userId, month)
  const total =
    usage.input_tokens + usage.output_tokens
  if (total >= MONTHLY_TOKEN_CAP) {
    return res.status(429).json({
      error: "Monthly AI quota exceeded",
      usage: total,
      cap: MONTHLY_TOKEN_CAP,
    })
  }
  req.aiMonth = month
  req.aiUsage = usage
  next()
}

// ── Helpers ─────────────────────────────────────────────

/**
 * Return the current billing month as "YYYY-MM".
 *
 * @returns {string}
 */
function currentMonth() {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(
    2, "0",
  )
  return `${y}-${m}`
}

/**
 * Fetch (or initialize) the usage row for a user+month.
 *
 * @param {string} userId - User UUID.
 * @param {string} month - YYYY-MM.
 * @returns {Promise<object>} Usage row.
 */
async function getUsage(userId, month) {
  const { data } = await supabase
    .from("ai_usage")
    .select("*")
    .eq("user_id", userId)
    .eq("month", month)
    .maybeSingle()
  return data || {
    user_id: userId,
    month,
    input_tokens: 0,
    output_tokens: 0,
    request_count: 0,
  }
}

/**
 * Increment usage counters after a successful request.
 *
 * @param {string} userId
 * @param {string} month
 * @param {number} inputTokens
 * @param {number} outputTokens
 */
async function recordUsage(
  userId, month, inputTokens, outputTokens,
) {
  // Atomic upsert — avoids read-then-write race
  // when concurrent requests increment the same row.
  const { error } = await supabase.rpc(
    "increment_ai_usage",
    {
      p_user_id: userId,
      p_month: month,
      p_input: inputTokens,
      p_output: outputTokens,
    },
  )
  // Fallback: if the RPC doesn't exist yet, use
  // the insert-or-update approach.
  if (error) {
    logger.warn(
      { error },
      "increment_ai_usage RPC failed, using upsert",
    )
    await supabase.from("ai_usage").upsert(
      {
        user_id: userId,
        month,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        request_count: 1,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,month" },
    )
  }
}

/**
 * Send a chat completion request via OpenRouter.
 *
 * OpenRouter uses the OpenAI-compatible chat
 * completions format, so this works with any model
 * available on their platform.
 *
 * @param {object} opts
 * @param {string} opts.model - OpenRouter model ID.
 * @param {string} [opts.system] - System prompt
 *   (prepended as a system message).
 * @param {Array} opts.messages - Chat messages.
 * @param {number} [opts.maxTokens=1024] - Max tokens.
 * @returns {Promise<object>} OpenAI-format response with
 *   ``choices[0].message.content`` and ``usage``.
 */
async function callModel(opts) {
  const messages = []
  if (opts.system) {
    messages.push({
      role: "system", content: opts.system,
    })
  }
  messages.push(...opts.messages)

  const body = {
    model: opts.model || MODEL_DEFAULT,
    max_tokens: opts.maxTokens || 1024,
    messages,
  }
  // Forward tool definitions if provided so the
  // model can emit tool_calls in its response.
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools
  }
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + OPENROUTER_API_KEY,
      "HTTP-Referer": "https://kaisho.dev",
      "X-Title": "Kaisho",
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errBody = await res.text()
    logger.error(
      { status: res.status, body: errBody },
      "OpenRouter API error",
    )
    throw new Error("OpenRouter API " + res.status)
  }
  return res.json()
}

/**
 * Extract the assistant's text from an OpenAI-format
 * chat completion response.
 *
 * @param {object} result - OpenRouter response.
 * @returns {string} The assistant's message text.
 */
function extractText(result) {
  return (
    result.choices?.[0]?.message?.content || ""
  )
}

/**
 * Extract token usage from an OpenRouter response.
 *
 * @param {object} result - OpenRouter response.
 * @returns {{ input: number, output: number }}
 */
function extractUsage(result) {
  return {
    input: result.usage?.prompt_tokens || 0,
    output: result.usage?.completion_tokens || 0,
  }
}

// ── POST /ai/complete ───────────────────────────────────

/**
 * General-purpose chat completion. Metered.
 *
 * @route POST /ai/complete
 */
router.post(
  "/complete",
  validate(aiCompleteSchema),
  requireOpenRouterKey,
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
    // Legacy clients without a mode fall back to the
    // ``model`` field (still gated by ALLOWED_MODELS).
    let chosen
    if (mode) {
      chosen = MODEL_BY_MODE[mode] || MODEL_BY_MODE.default
    } else {
      chosen = model || MODEL_DEFAULT
      if (!ALLOWED_MODELS.has(chosen)) {
        return res.status(400).json({
          error: `Model not allowed: ${chosen}`,
        })
      }
    }

    const result = await callModel({
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
  requireOpenRouterKey,
  asyncHandler(requireTokenQuota),
  asyncHandler(async (req, res) => {
    const { text: input } = req.body
    const month = req.aiMonth

    // Use the fast/cheap model for structured
    // extraction — no need for a large LLM here.
    const result = await callModel({
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

/**
 * Regex fallback for simple booking strings.
 *
 * Patterns: "2h acme", "30m maintenance", "1h30m acme
 * fix login". First word after duration is customer,
 * rest is description.
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
  requireOpenRouterKey,
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
    const usage = await getUsage(req.userId, month)
    res.json({
      month,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      total_tokens:
        usage.input_tokens + usage.output_tokens,
      request_count: usage.request_count,
      cap: MONTHLY_TOKEN_CAP,
    })
  }),
)

module.exports = router
