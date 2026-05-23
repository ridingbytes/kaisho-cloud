"use strict"

/**
 * @module ai/engine
 *
 * AI gateway core: backend resolution, model selection,
 * quota/cap resolution, the OpenRouter call, and usage
 * metering. Shared by the HTTP gateway (routes/ai.js) and
 * the hosted cron worker (workers/cron.js) so both meter
 * against the same ``ai_usage`` table with the same cap
 * and model-selection logic.
 *
 * This module is transport-agnostic — it contains no
 * Express types. HTTP concerns (guards, route handlers)
 * stay in routes/ai.js.
 */

const crypto = require("crypto")
const { supabase } = require("../db")
const { PLAN_QUOTAS } = require("../config")
const { logger } = require("../logger")

// ── Backend defaults ────────────────────────────────────
//
// Last-resort fallback when the gateway_config table is
// empty/unreachable. Effective per-request values come
// from getBackend() / resolveModel() / resolveCap().

const FALLBACK_BACKEND_URL =
  process.env.BACKEND_URL
  || "https://openrouter.ai/api/v1/chat/completions"
const FALLBACK_BACKEND_API_KEY_ENV =
  process.env.BACKEND_API_KEY_ENV
  || "OPENROUTER_API_KEY"
const FALLBACK_BACKEND_LABEL =
  process.env.BACKEND_LABEL || "openrouter"

const MODEL_FAST = process.env.AI_MODEL_FAST
  || "google/gemini-2.0-flash-lite-001"
const MODEL_DEFAULT = process.env.AI_MODEL_DEFAULT
  || "anthropic/claude-sonnet-4"

// Mode → model fallback defaults for kaisho:* requests.
const FALLBACK_MODEL_BY_MODE = {
  advisor: process.env.AI_MODEL_ADVISOR
    || "anthropic/claude-haiku-4.5",
  cron: process.env.AI_MODEL_CRON
    || "google/gemma-4-31b-it",
  default: process.env.AI_MODEL_KAISHO_DEFAULT
    || "anthropic/claude-haiku-4.5",
}

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

const FALLBACK_MONTHLY_TOKEN_CAP = 250_000

// ── Defensive allowlists ───────────────────────────────
//
// gateway_config and users.*_override are editable via
// SQL. These code-level allowlists stop a SQL-only
// compromise from exfiltrating other secrets via the
// backend Bearer token or routing traffic to an
// unapproved (expensive) model.

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
 * Return the first 8 hex chars of SHA-256 of a string.
 * Logs rejected attacker-controlled values without
 * echoing them verbatim. Collision-prone by design — the
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
 * Return the validated user override for a given mode, or
 * null if absent / not in ALLOWED_MODELS.
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
 * Resolve the backend to call right now. The API key is
 * NOT stored in the DB — only the env-var name, which is
 * checked against ALLOWED_BACKEND_KEY_ENVS.
 *
 * @returns {Promise<{
 *   url: string, apiKey: string, label: string,
 * }>}
 */
async function getBackend() {
  const cfg = await getGatewayConfig()
  let envName = cfg.backend_api_key_env
  if (!isAllowedKeyEnv(envName)) {
    logger.error(
      { backend_api_key_env_hash: hashShort(envName) },
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
 * @returns {Promise<object>}
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
 *   1. users.monthly_token_cap_override (absolute)
 *   2. PLAN_QUOTAS[plan] + bonus_tokens_remaining
 *   3. gateway_config.monthly_token_cap (fallback)
 *
 * @param {string} userId
 * @param {string} plan
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
 * Return the gateway_config model for a key, validated
 * against ALLOWED_MODELS. Falls back to the env-baked
 * default when the row's value isn't allowed.
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
  const safeOverride = safeOverrideModel(overrides, mode)
  if (safeOverride) return safeOverride

  let modelKey
  if (mode === "advisor") modelKey = "model_advisor"
  else if (mode === "cron") modelKey = "model_cron"
  else modelKey = "model_default"
  return safeConfigModel(config, modelKey, mode)
}

// ── Usage metering ─────────────────────────────────────

/**
 * Return the current billing month as "YYYY-MM".
 *
 * @returns {string}
 */
function currentMonth() {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, "0")
  return `${y}-${m}`
}

/**
 * Fetch (or initialize) the usage row for a user+month.
 *
 * @param {string} userId
 * @param {string} month - YYYY-MM.
 * @returns {Promise<object>}
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
 * Atomic via the increment_ai_usage RPC (migration 005).
 * Throws loudly if the RPC fails — metering must not
 * silently corrupt.
 *
 * @param {string} userId
 * @param {string} month
 * @param {number} inputTokens
 * @param {number} outputTokens
 */
async function recordUsage(
  userId, month, inputTokens, outputTokens,
) {
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
    throw new Error("AI usage metering unavailable")
  }
}

// ── Model call ─────────────────────────────────────────

/**
 * Send a chat completion request via the configured
 * OpenAI-compatible backend (OpenRouter by default).
 *
 * @param {object} opts
 * @param {string} opts.model
 * @param {string} [opts.system]
 * @param {Array} opts.messages
 * @param {number} [opts.maxTokens=1024]
 * @param {Array} [opts.tools]
 * @param {object} [opts.backend] - Pre-resolved backend.
 * @returns {Promise<object>} OpenAI-format response.
 */
async function callModel(opts) {
  const messages = []
  if (opts.system) {
    messages.push({ role: "system", content: opts.system })
  }
  messages.push(...opts.messages)

  const body = {
    model: opts.model || MODEL_DEFAULT,
    max_tokens: opts.maxTokens || 1024,
    messages,
  }
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools
  }

  const backend = opts.backend || await getBackend()
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
    throw new Error(backend.label + " API " + res.status)
  }
  return res.json()
}

/**
 * Extract the assistant's text from an OpenAI-format
 * chat completion response.
 *
 * @param {object} result
 * @returns {string}
 */
function extractText(result) {
  return result.choices?.[0]?.message?.content || ""
}

/**
 * Extract token usage from an OpenAI-format response.
 *
 * @param {object} result
 * @returns {{ input: number, output: number }}
 */
function extractUsage(result) {
  return {
    input: result.usage?.prompt_tokens || 0,
    output: result.usage?.completion_tokens || 0,
  }
}

module.exports = {
  // Constants other modules need
  MODEL_FAST,
  MODEL_DEFAULT,
  ALLOWED_MODELS,
  // Config + resolution
  getGatewayConfig,
  getBackend,
  getUserOverrides,
  resolveCap,
  resolveModel,
  // Metering
  currentMonth,
  getUsage,
  recordUsage,
  // Model call
  callModel,
  extractText,
  extractUsage,
}
