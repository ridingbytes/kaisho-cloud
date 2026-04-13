"use strict"

const { rateLimit } = require("express-rate-limit")

// ── Plan configuration ───────────────────────────────────

const PLAN_PRICES = {
  sync:    process.env.STRIPE_PRICE_SYNC,
  sync_ai: process.env.STRIPE_PRICE_SYNC_AI,
}

function planFromPriceId(priceId) {
  for (const [plan, id] of Object.entries(PLAN_PRICES)) {
    if (id === priceId) return plan
  }
  return null
}

// ── Rate limiters ────────────────────────────────────────

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

// ── Constants ────────────────────────────────────────────

const PORT = process.env.PORT || 3000
const BASE_URL =
  process.env.BASE_URL || "https://cloud.kaisho.app"

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
