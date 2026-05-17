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

const crypto = require("crypto")
const { Router } = require("express")
const { supabase } = require("../db")
const {
  requireAuth, requirePlan,
} = require("../middleware")
const { apiLimiter, PLAN_QUOTAS } = require("../config")
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
// Any paid tier grants AI gateway access. The per-plan
// monthly token quota is enforced separately by
// requireTokenQuota below.
router.use(requirePlan("companion", "pro", "team"))

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

// ── Defensive allowlists ──────────────────────────────
//
// Everything in gateway_config and users.*_override is
// editable via SQL. Without these allowlists, an actor
// with DB write access could:
//
//   - Set backend_api_key_env to "STRIPE_SECRET_KEY",
//     "SUPABASE_SERVICE_KEY", etc., and exfiltrate the
//     value via the Bearer token sent to backend_url.
//   - Set users.advisor_model_override to an arbitrary
//     OpenRouter slug and burn the master key on
//     anything available there.
//
// Both lists live in code (not the DB) so a SQL-only
// compromise can't widen them.

const ALLOWED_BACKEND_KEY_ENVS = new Set([
  "OPENROUTER_API_KEY",
  "OLLAMA_CLOUD_API_KEY",
  "LITELLM_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_API_KEY",
])

function isAllowedKeyEnv(name) {
  return ALLOWED_BACKEND_KEY_ENVS.has(name)
}

/**
 * Return the first 8 hex chars of SHA-256 of an arbitrary
 * string. Used to log rejected attacker-controlled values
 * without echoing them verbatim. Collision-prone — the
 * point is correlation, not identity.
 */
function hashShort(value) {
  if (typeof value !== "string") return "non-string"
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex")
    .slice(0, 8)
}

/**
 * Return the validated user override for a given mode,
 * or null if absent / unrecognised. An override pointing
 * at a slug not in ALLOWED_MODELS is treated as null and
 * logged so we don't burn the master key on a model the
 * platform never approved.
 */
function safeOverrideModel(overrides, mode) {
  const key =
    mode === "advisor" ? "advisor_model_override"
    : mode === "cron" ? "cron_model_override"
    : null
  if (!key) return null
  const value = overrides?.[key]
  if (!value) return null
  if (!ALLOWED_MODELS.has(value)) {
    logger.warn(
      { user_override: value, mode },
      "user model override not in ALLOWED_MODELS; "
      + "falling back to gateway_config",
    )
    return null
  }
  return value
}

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
  // Defense: if the DB-stored env-var name is not on the
  // code-level allowlist, refuse to read it. Avoids
  // exfiltrating Stripe / Supabase / etc. keys via a
  // single compromised SQL row.
  let envName = cfg.backend_api_key_env
  if (!isAllowedKeyEnv(envName)) {
    // Don't log the rejected name verbatim — an attacker
    // who tampered the row controls the string and can
    // inject log lines or exfiltrate via log aggregation.
    // Log only the SHA-256 prefix so operators can match
    // a single rejection across logs without exposing
    // the literal value.
    logger.error(
      {
        backend_api_key_env_hash: hashShort(envName),
      },
      "gateway_config.backend_api_key_env not in "
      + "ALLOWED_BACKEND_KEY_ENVS; falling back to "
      + "env default",
    )
    envName = FALLBACK_BACKEND_API_KEY_ENV
  }
  const apiKey = process.env[envName] || ""
  return {
    url: cfg.backend_url,
    apiKey,
    label: cfg.backend_label,
  }
}

/**
 * Fetch the per-user override and bonus columns. NULL
 * override fields mean "use the per-plan default".
 *
 * @param {string} userId
 * @returns {Promise<{
 *   monthly_token_cap_override: number | null,
 *   advisor_model_override: string | null,
 *   cron_model_override: string | null,
 *   bonus_tokens_remaining: number,
 * }>}
 */
async function getUserOverrides(userId) {
  const { data } = await supabase
    .from("users")
    .select(
      "monthly_token_cap_override, "
      + "advisor_model_override, "
      + "cron_model_override, "
      + "bonus_tokens_remaining",
    )
    .eq("id", userId)
    .maybeSingle()
  return data || {
    monthly_token_cap_override: null,
    advisor_model_override: null,
    cron_model_override: null,
    bonus_tokens_remaining: 0,
  }
}

/**
 * Resolve the effective monthly token cap for a user.
 *
 * Resolution order:
 *   1. users.monthly_token_cap_override (absolute
 *      operator override; bonus tokens not added)
 *   2. PLAN_QUOTAS[plan].tokens_per_month +
 *      users.bonus_tokens_remaining (normal path)
 *   3. gateway_config.monthly_token_cap (defensive
 *      fallback for plans not in PLAN_QUOTAS — should
 *      not happen since requirePlan upstream restricts
 *      callers, but keeps the gateway functional in
 *      case of plan-rename drift)
 *
 * @param {string} userId
 * @param {string} plan - User's current plan name.
 * @returns {Promise<number>}
 */
async function resolveCap(userId, plan) {
  const overrides = await getUserOverrides(userId)
  if (overrides.monthly_token_cap_override != null) {
    return overrides.monthly_token_cap_override
  }
  const planQuota = PLAN_QUOTAS[plan]
  if (planQuota) {
    return (
      planQuota.tokens_per_month
      + (overrides.bonus_tokens_remaining || 0)
    )
  }
  const config = await getGatewayConfig()
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
  // Per-user override wins only if it's in
  // ALLOWED_MODELS — otherwise we'd let a single
  // compromised users row direct traffic to an
  // unapproved (and possibly very expensive) model.
  const safeOverride = safeOverrideModel(overrides, mode)
  if (safeOverride) return safeOverride

  // gateway_config model fields go through the same
  // allowlist. PR #4 only validated per-user overrides;
  // a SQL write to gateway_config could still route
  // every user to an arbitrary slug, bypassing the
  // check. Apply the same defense here.
  let modelKey
  if (mode === "advisor") modelKey = "model_advisor"
  else if (mode === "cron") modelKey = "model_cron"
  else modelKey = "model_default"
  return safeConfigModel(config, modelKey, mode)
}

/**
 * Return the gateway_config model for a key, validated
 * against ALLOWED_MODELS. Falls back to the env-baked
 * FALLBACK_MODEL_BY_MODE constant when the row's value
 * isn't allowed (logs a warning so the operator notices).
 */
function safeConfigModel(config, key, mode) {
  const value = config?.[key]
  if (value && ALLOWED_MODELS.has(value)) return value
  const fallback = (
    FALLBACK_MODEL_BY_MODE[mode]
    || FALLBACK_MODEL_BY_MODE.default
  )
  if (value) {
    logger.warn(
      { gateway_config_value: value, mode, key },
      "gateway_config model not in ALLOWED_MODELS; "
      + "falling back to env default",
    )
  }
  return fallback
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
    resolveCap(req.userId, req.userPlan),
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
  // Atomic increment via the increment_ai_usage RPC
  // (migration 005). Avoids the read-then-write race
  // when concurrent requests touch the same row.
  //
  // The RPC has shipped since 1.0.0 — there is no
  // fallback. A previous insert-or-update fallback
  // OVERWROTE the existing row's counters with just
  // the current request's tokens, silently corrupting
  // metering whenever the RPC errored. Better to fail
  // loudly: if this throws, the request 5xxs and the
  // operator gets paged.
  const { error } = await supabase.rpc(
    "increment_ai_usage",
    {
      p_user_id: userId,
      p_month: month,
      p_input: inputTokens,
      p_output: outputTokens,
    },
  )
  if (error) {
    logger.error(
      { error },
      "increment_ai_usage RPC failed; usage metering "
      + "is broken until this is restored",
    )
    throw new Error(
      "AI usage metering unavailable",
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
