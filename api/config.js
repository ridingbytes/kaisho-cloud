"use strict"

/**
 * Application configuration — plan prices, rate
 * limiters, and environment constants.
 */

const { rateLimit } = require("express-rate-limit")

// ── Env validation ──────────────────────────────────────

const REQUIRED = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY"]
for (const key of REQUIRED) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`)
  }
}

// ── Plan configuration ──────────────────────────────────

// Per-plan monthly token quota for the AI gateway. Adding
// users.bonus_tokens_remaining (from token_pack purchases)
// on top gives the user's effective cap. The per-user
// users.monthly_token_cap_override column, when not null,
// overrides this number entirely (operator escape hatch).
//
// Tweaking these requires a deploy. For runtime knobs
// without a restart, set the per-user override column.
const PLAN_QUOTAS = {
  free:      { tokens_per_month: 0 },
  companion: { tokens_per_month: 500_000 },
  pro:       { tokens_per_month: 2_000_000 },
  // Team is per-seat in Stripe but per-user in the DB
  // (one users row per seat). Each seat gets the same
  // quota as Pro.
  team:      { tokens_per_month: 2_000_000 },
}

// Stripe price → plan name. Subscription prices map to
// the plan they grant; the token-pack one-time price maps
// to the special "token_pack" sentinel so the webhook
// handler can route it to the credit-tokens branch
// instead of the plan-upgrade branch.
const PLAN_PRICES = {
  companion: process.env.STRIPE_PRICE_COMPANION_MONTHLY,
  companion_yearly:
    process.env.STRIPE_PRICE_COMPANION_YEARLY,
  pro:       process.env.STRIPE_PRICE_PRO_MONTHLY,
  pro_yearly:
    process.env.STRIPE_PRICE_PRO_YEARLY,
  team:      process.env.STRIPE_PRICE_TEAM_MONTHLY,
  team_yearly:
    process.env.STRIPE_PRICE_TEAM_YEARLY,
  token_pack:
    process.env.STRIPE_PRICE_TOKEN_PACK_500K,
}

// How many bonus tokens each one-time pack grants. Today
// only one pack size; if more land later, key by price ID.
const TOKEN_PACK_SIZE = 500_000

/**
 * Look up a plan name by its Stripe price ID.
 *
 * The returned value is one of "companion", "pro",
 * "team", or "token_pack". The "_yearly" suffixed keys
 * collapse to their base tier so the webhook handler
 * does not have to differentiate billing cadence.
 *
 * @param {string} priceId - Stripe price ID.
 * @returns {string|null} Plan name or null.
 */
function planFromPriceId(priceId) {
  for (const [key, id] of Object.entries(PLAN_PRICES)) {
    if (id === priceId) {
      // Collapse "*_yearly" → base plan name.
      return key.endsWith("_yearly")
        ? key.slice(0, -"_yearly".length)
        : key
    }
  }
  return null
}

// ── Rate limiters ───────────────────────────────────────

/** @type {Function} 5 req/hour signup limiter. */
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error:
      "Too many signup attempts. Try again in an hour.",
  },
})

/** @type {Function} 30 req/15 min auth limiter. */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error:
      "Too many auth attempts. " +
      "Try again in 15 minutes.",
  },
})

// Unauthenticated OAuth callback. The state-token HMAC
// blocks identity forgery, but doesn't stop CPU/state
// verification spam from an open endpoint. 60/min/IP is
// generous for a real user (1-3 callbacks per connect)
// while keeping a hostile loop bounded.
/** @type {Function} 60 req/min IP-keyed OAuth limiter. */
const oauthCallbackLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: "Too many OAuth callbacks. Slow down.",
  },
})

/** @type {Function} 5 req/hour key rotation limiter. */
const rotateKeyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error:
      "Too many key rotation attempts. " +
      "Try again in an hour.",
  },
})

// Dedicated bucket for /sync/* routes. A desktop with
// >60k clock entries pushes >120 batches of 500 during
// initial sync (clocks + inbox + tasks + notes pulls and
// pushes) and saturates the 120/min apiLimiter, surfacing
// to the user as a stuck progress bar. 600/min lets a
// fresh sync complete without throttling while still
// limiting a hostile loop.
/** @type {Function} 600 req/min per-user sync limiter. */
const syncLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.userId || req.ip,
  message: {
    error: "Too many sync requests. Please slow down.",
  },
})

/** @type {Function} 120 req/min per-user API limiter. */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.userId || "unknown",
  message: {
    error: "Too many requests. Please slow down.",
  },
})

// ── Constants ───────────────────────────────────────────

const PORT = process.env.PORT || 3000
const BASE_URL =
  process.env.BASE_URL || "https://cloud.kaisho.dev"

module.exports = {
  PLAN_PRICES,
  PLAN_QUOTAS,
  TOKEN_PACK_SIZE,
  planFromPriceId,
  signupLimiter,
  authLimiter,
  rotateKeyLimiter,
  apiLimiter,
  syncLimiter,
  oauthCallbackLimiter,
  PORT,
  BASE_URL,
}
