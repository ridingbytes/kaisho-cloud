"use strict"

/**
 * @module routes/ai
 *
 * Cloud AI gateway. Proxies requests to the Anthropic
 * Claude API using a single master key owned by the
 * platform. Usage is metered per user per month in the
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

// Monthly soft cap: 200K tokens. Requests over this
// limit return 429 instead of proxying. The cap prevents
// runaway costs while keeping the UX friendly.
const MONTHLY_TOKEN_CAP = 200_000

// ── Helpers ─────────────────────────────────────────────

/**
 * Return the current billing month as "YYYY-MM".
 *
 * @returns {string}
 */
function currentMonth() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
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
  const { data: row } = await supabase
    .from("ai_usage")
    .select("input_tokens, output_tokens, request_count")
    .eq("user_id", userId)
    .eq("month", month)
    .maybeSingle()

  if (row) {
    await supabase
      .from("ai_usage")
      .update({
        input_tokens: row.input_tokens + inputTokens,
        output_tokens: row.output_tokens + outputTokens,
        request_count: row.request_count + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("month", month)
  } else {
    await supabase.from("ai_usage").insert({
      user_id: userId,
      month,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      request_count: 1,
    })
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
 * General-purpose Claude completion. Metered.
 *
 * @route POST /ai/complete
 */
router.post(
  "/complete",
  asyncHandler(async (req, res) => {
    if (!OPENROUTER_API_KEY) {
      return res
        .status(503)
        .json({ error: "AI not configured" })
    }

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

    const { system, messages, max_tokens, model } =
      req.body
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        error: "messages array is required",
      })
    }

    const result = await callModel({
      model: model || MODEL_DEFAULT,
      system,
      messages,
      maxTokens: Math.min(max_tokens || 1024, 4096),
    })

    const { input: inTok, output: outTok } =
      extractUsage(result)
    await recordUsage(req.userId, month, inTok, outTok)

    res.json({
      text: extractText(result),
      usage: {
        input_tokens: inTok,
        output_tokens: outTok,
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
 * Parse a natural-language booking into structured
 * fields. Uses a regex fallback for simple patterns
 * like "2h acme" to save an API call.
 *
 * @route POST /ai/parse-booking
 */
router.post(
  "/parse-booking",
  asyncHandler(async (req, res) => {
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

    if (!OPENROUTER_API_KEY) {
      return res.status(503).json({
        error: "AI not configured",
      })
    }

    const month = currentMonth()
    const usage = await getUsage(req.userId, month)
    if (
      usage.input_tokens + usage.output_tokens
      >= MONTHLY_TOKEN_CAP
    ) {
      return res.status(429).json({
        error: "Monthly AI quota exceeded",
      })
    }

    // Use the fast/cheap model for structured
    // extraction — no need for a large LLM here.
    const result = await callModel({
      model: MODEL_FAST,
      system: PARSE_SYSTEM,
      messages: [{ role: "user", content: text }],
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
  asyncHandler(async (req, res) => {
    const { entries } = req.body
    if (!entries || !Array.isArray(entries)) {
      return res.status(400).json({
        error: "entries array is required",
      })
    }

    if (!OPENROUTER_API_KEY) {
      return res.status(503).json({
        error: "AI not configured",
      })
    }

    const month = currentMonth()
    const usage = await getUsage(req.userId, month)
    if (
      usage.input_tokens + usage.output_tokens
      >= MONTHLY_TOKEN_CAP
    ) {
      return res.status(429).json({
        error: "Monthly AI quota exceeded",
      })
    }

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
