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

// Backend defaults — used as last-resort fallback when
// the gateway_config table is empty/unreachable. The
// effective values per request come from getBackend().
const FALLBACK_BACKEND_URL =
  process.env.BACKEND_URL
  || "https://openrouter.ai/api/v1/chat/completions"
const FALLBACK_BACKEND_API_KEY_ENV =
  process.env.BACKEND_API_KEY_ENV
  || "OPENROUTER_API_KEY"
const FALLBACK_BACKEND_LABEL =
  process.env.BACKEND_LABEL || "openrouter"

// Model selection per use case:
//   - FAST: cheap structured extraction (parse-booking)
//   - DEFAULT: general completion + summarization
const MODEL_FAST = process.env.AI_MODEL_FAST
  || "google/gemini-2.0-flash-lite-001"
const MODEL_DEFAULT = process.env.AI_MODEL_DEFAULT
  || "anthropic/claude-sonnet-4"

// Mode → model defaults for kaisho:* requests. Clients
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
//
// These are the LAST-RESORT fallback if the
// gateway_config table is empty or unreachable. The
// effective model used per request comes from
// resolveModel(): user override → gateway_config →
// these env values.
const FALLBACK_MODEL_BY_MODE = {
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

// Last-resort cap when the gateway_config table is
// empty/unreachable. Effective cap per user comes from
// resolveCap(): user override → gateway_config → this.
const FALLBACK_MONTHLY_TOKEN_CAP = 250_000

// ── Runtime config (gateway_config table) ──────────────
//
// Cached for CONFIG_TTL_MS so requests don't hit Supabase
// for config on every call. Refresh interval is short
// enough (60s) that ops changes via SQL feel near-instant
// without the gateway needing a restart.

const CONFIG_TTL_MS = 60_000

/** @type {{ data: object, fetchedAt: number } | null} */
let _configCache = null

async function getGatewayConfig() {
  if (_configCache
      && Date.now() - _configCache.fetchedAt
         < CONFIG_TTL_MS) {
    return _configCache.data
  }
  try {
    const { data, error } = await supabase
      .from("gateway_config")
      .select("*")
      .eq("id", 1)
      .maybeSingle()
    if (error) throw error
    if (!data) throw new Error("gateway_config row missing")
    _configCache = { data, fetchedAt: Date.now() }
    return data
  } catch (err) {
    // Fall back to env defaults — keeps the gateway
    // serving requests even if the migration hasn't run
    // or Supabase is briefly unreachable.
    logger.warn(
      { err: err.message },
      "gateway_config read failed, using env fallbacks",
    )
    return {
      backend_url: FALLBACK_BACKEND_URL,
      backend_api_key_env: FALLBACK_BACKEND_API_KEY_ENV,
      backend_label: FALLBACK_BACKEND_LABEL,
      monthly_token_cap: FALLBACK_MONTHLY_TOKEN_CAP,
      model_advisor: FALLBACK_MODEL_BY_MODE.advisor,
      model_cron: FALLBACK_MODEL_BY_MODE.cron,
      model_default: FALLBACK_MODEL_BY_MODE.default,
      max_tokens_per_request: 8192,
    }
  }
}

/**
 * Resolve the backend to call right now. Reads
 * backend_url and the API key (looked up via the env var
 * name in backend_api_key_env) from gateway_config. The
 * key is NOT stored in the DB — only the env-var name.
 *
 * @returns {Promise<{
 *   url: string, apiKey: string, label: string,
 * }>}
 */
async function getBackend() {
  const cfg = await getGatewayConfig()
  const apiKey =
    process.env[cfg.backend_api_key_env] || ""
  return {
    url: cfg.backend_url,
    apiKey,
    label: cfg.backend_label,
  }
}

/**
 * Fetch the per-user override columns. NULL fields mean
 * "use the gateway_config value".
 *
 * @param {string} userId
 * @returns {Promise<{
 *   monthly_token_cap_override: number | null,
 *   advisor_model_override: string | null,
 *   cron_model_override: string | null,
 * }>}
 */
async function getUserOverrides(userId) {
  const { data } = await supabase
    .from("users")
    .select(
      "monthly_token_cap_override, "
      + "advisor_model_override, "
      + "cron_model_override",
    )
    .eq("id", userId)
    .maybeSingle()
  return data || {
    monthly_token_cap_override: null,
    advisor_model_override: null,
    cron_model_override: null,
  }
}

/**
 * Resolve the effective monthly token cap for a user:
 * user override → gateway_config → env fallback.
 *
 * @param {string} userId
 * @returns {Promise<number>}
 */
async function resolveCap(userId) {
  const [config, overrides] = await Promise.all([
    getGatewayConfig(),
    getUserOverrides(userId),
  ])
  if (overrides.monthly_token_cap_override != null) {
    return overrides.monthly_token_cap_override
  }
  return config.monthly_token_cap
}

/**
 * Resolve the effective model for a kaisho:* mode call:
 * user override (advisor / cron only) → gateway_config →
 * fallback constant.
 *
 * @param {string} userId
 * @param {string} mode - "advisor", "cron", or "default".
 * @returns {Promise<string>}
 */
async function resolveModel(userId, mode) {
  const [config, overrides] = await Promise.all([
    getGatewayConfig(),
    getUserOverrides(userId),
  ])
  if (mode === "advisor"
      && overrides.advisor_model_override) {
    return overrides.advisor_model_override
  }
  if (mode === "cron"
      && overrides.cron_model_override) {
    return overrides.cron_model_override
  }
  if (mode === "advisor") return config.model_advisor
  if (mode === "cron") return config.model_cron
  return config.model_default
}

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
  const [usage, cap] = await Promise.all([
    getUsage(req.userId, month),
    resolveCap(req.userId),
  ])
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

  const backend = opts.backend || await getBackend()
  // OpenRouter looks at HTTP-Referer / X-Title for
  // attribution; other OpenAI-compatible backends
  // ignore them. Always sending is harmless.
  const res = await fetch(backend.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + backend.apiKey,
      "HTTP-Referer": "https://kaisho.dev",
      "X-Title": "Kaisho",
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errBody = await res.text()
    logger.error(
      {
        status: res.status,
        backend: backend.label,
        body: errBody,
      },
      "AI backend error",
    )
    throw new Error(
      backend.label + " API " + res.status,
    )
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
  asyncHandler(requireBackendKey),
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
    const [usage, cap] = await Promise.all([
      getUsage(req.userId, month),
      resolveCap(req.userId),
    ])
    res.json({
      month,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      total_tokens:
        usage.input_tokens + usage.output_tokens,
      request_count: usage.request_count,
      cap,
    })
  }),
)

module.exports = router
