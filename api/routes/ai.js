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

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || ""
const CLAUDE_MODEL =
  process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514"
const CLAUDE_URL =
  "https://api.anthropic.com/v1/messages"

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
 * Send a request to the Anthropic Messages API.
 *
 * @param {object} opts
 * @param {string} opts.system - System prompt.
 * @param {Array} opts.messages - Message array.
 * @param {number} [opts.maxTokens=1024] - Max tokens.
 * @returns {Promise<object>} Anthropic response.
 */
async function callClaude(opts) {
  const body = {
    model: CLAUDE_MODEL,
    max_tokens: opts.maxTokens || 1024,
    system: opts.system || undefined,
    messages: opts.messages,
  }
  const res = await fetch(CLAUDE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CLAUDE_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errBody = await res.text()
    logger.error(
      { status: res.status, body: errBody },
      "Claude API error",
    )
    throw new Error("Claude API " + res.status)
  }
  return res.json()
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
    if (!CLAUDE_API_KEY) {
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

    const { system, messages, max_tokens } = req.body
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        error: "messages array is required",
      })
    }

    const result = await callClaude({
      system,
      messages,
      maxTokens: Math.min(max_tokens || 1024, 4096),
    })

    const inTok = result.usage?.input_tokens || 0
    const outTok = result.usage?.output_tokens || 0
    await recordUsage(req.userId, month, inTok, outTok)

    res.json({
      content: result.content,
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

    if (!CLAUDE_API_KEY) {
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

    const result = await callClaude({
      system: PARSE_SYSTEM,
      messages: [{ role: "user", content: text }],
      maxTokens: 256,
    })

    const inTok = result.usage?.input_tokens || 0
    const outTok = result.usage?.output_tokens || 0
    await recordUsage(req.userId, month, inTok, outTok)

    let parsed
    try {
      const raw = result.content?.[0]?.text || "{}"
      parsed = JSON.parse(raw)
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

    if (!CLAUDE_API_KEY) {
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

    const result = await callClaude({
      system: SUMMARY_SYSTEM,
      messages: [{
        role: "user",
        content: JSON.stringify(compact),
      }],
      maxTokens: 512,
    })

    const inTok = result.usage?.input_tokens || 0
    const outTok = result.usage?.output_tokens || 0
    await recordUsage(req.userId, month, inTok, outTok)

    const summary = result.content?.[0]?.text || ""
    res.json({ summary })
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
