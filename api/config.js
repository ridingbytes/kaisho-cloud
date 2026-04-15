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

const PLAN_PRICES = {
  sync:    process.env.STRIPE_PRICE_SYNC,
  sync_ai: process.env.STRIPE_PRICE_SYNC_AI,
}

/**
 * Look up a plan name by its Stripe price ID.
 *
 * @param {string} priceId - Stripe price ID.
 * @returns {string|null} Plan name or null.
 */
function planFromPriceId(priceId) {
  for (const [plan, id] of Object.entries(PLAN_PRICES)) {
    if (id === priceId) return plan
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
  validate: { xForwardedForHeader: false },
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
  validate: { xForwardedForHeader: false },
  message: {
    error:
      "Too many auth attempts. " +
      "Try again in 15 minutes.",
  },
})

/** @type {Function} 5 req/hour key rotation limiter. */
const rotateKeyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: {
    error:
      "Too many key rotation attempts. " +
      "Try again in an hour.",
  },
})

/** @type {Function} 120 req/min per-user API limiter. */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
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
  planFromPriceId,
  signupLimiter,
  authLimiter,
  rotateKeyLimiter,
  apiLimiter,
  PORT,
  BASE_URL,
}
