"use strict"

/**
 * Application configuration — plan prices, rate
 * limiters, and environment constants.
 */

const { rateLimit } = require("express-rate-limit")

// ── Env validation ──────────────────────────────────────

// AGPL-3.0 section 13: a network user must be able to get
// the source of the instance they are using. Operators who
// run a modified build MUST point this at their fork —
// leaving it at ours would offer source that is not the
// source of the running program.
const SOURCE_URL = process.env.SOURCE_URL
  || "https://github.com/ridingbytes/kaisho-cloud"

const REQUIRED = ["DATABASE_URL", "JWT_SECRET"]
for (const key of REQUIRED) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`)
  }
}

// Single source of truth for the default task status used
// when an API caller (CLI, MCP, mobile) creates a task
// without specifying one. Five call sites used to inline
// this literal which silently drifted between them.
const DEFAULT_TASK_STATUS = "TODO"


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
  // Fail closed when something mounts apiLimiter without
  // a preceding requireAuth: fall back to req.ip (real
  // client IP, since `app.set("trust proxy", 1)`) so the
  // bucket is per-attacker, not a shared "unknown" pool
  // that a single bad actor could exhaust for everyone.
  keyGenerator: (req) => req.userId || req.ip,
  message: {
    error: "Too many requests. Please slow down.",
  },
})

// ── Constants ───────────────────────────────────────────

const PORT = process.env.PORT || 3000
const BASE_URL =
  process.env.BASE_URL || "https://cloud.kaisho.dev"

module.exports = {
  DEFAULT_TASK_STATUS,
  signupLimiter,
  authLimiter,
  rotateKeyLimiter,
  apiLimiter,
  syncLimiter,
  oauthCallbackLimiter,
  PORT,
  BASE_URL,
  SOURCE_URL,
}
