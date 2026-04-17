"use strict"

const bcrypt = require("bcryptjs")
const { logger } = require("./logger")
const {
  supabase,
  supabaseAuth,
  getCachedUser,
  cacheUser,
} = require("./db")

// ── JWT auth (mobile users via Supabase Auth) ───────────

/**
 * Require a valid Supabase JWT in the Authorization
 * header. Sets req.userId and req.userEmail.
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
async function requireJwt(req, res, next) {
  const auth = req.headers.authorization
  if (!auth?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" })
  }
  const token = auth.slice(7)

  const { data, error } = await supabaseAuth.auth.getUser(token)
  if (error || !data?.user) {
    return res.status(401).json({ error: "Invalid token" })
  }

  req.userId = data.user.id
  req.userEmail = data.user.email
  next()
}

// ── API key auth (local sync client) ────────────────────

/**
 * Require a valid API key in the Authorization header.
 * Checks all users with a key hash and caches positive
 * matches. Sets req.userId and req.userPlan.
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
async function requireApiKey(req, res, next) {
  const auth = req.headers.authorization
  if (!auth?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" })
  }
  const apiKey = auth.slice(7)

  const { data: users } = await supabase
    .from("users")
    .select("id, plan, api_key_hash")
    .not("api_key_hash", "is", null)

  if (!users) {
    return res.status(401).json({ error: "Unauthorized" })
  }

  for (const user of users) {
    const cached = getCachedUser(user.id, apiKey)
    if (cached) {
      req.userId = cached.id
      req.userPlan = cached.plan
      return next()
    }

    const match = await bcrypt.compare(
      apiKey, user.api_key_hash,
    )
    if (match) {
      cacheUser(user.id, apiKey, user)
      req.userId = user.id
      req.userPlan = user.plan
      return next()
    }
  }

  return res.status(401).json({ error: "Invalid API key" })
}

// ── Combined auth (JWT or API key) ──────────────────────

/**
 * Accept either a Supabase JWT or an API key. Tries JWT
 * first for tokens longer than 50 characters, then falls
 * back to API key auth.
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
async function requireAuth(req, res, next) {
  const auth = req.headers.authorization
  if (!auth?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" })
  }

  const token = auth.slice(7)

  if (token.length > 50) {
    const { data, error } =
      await supabaseAuth.auth.getUser(token)
    if (!error && data?.user) {
      req.userId = data.user.id
      req.userEmail = data.user.email
      return next()
    }
  }

  return requireApiKey(req, res, next)
}

// ── Plan enforcement ────────────────────────────────────

/**
 * Require the authenticated user to be on one of the
 * given plans. Returns 403 if not.
 *
 * @param {...string} plans - Allowed plan names.
 * @returns {Function} Express middleware.
 */
function requirePlan(...plans) {
  return async (req, res, next) => {
    // Look up by auth UID. If the user row doesn't
    // exist yet (first login), auto-create it with
    // the free plan.
    let { data: user } = await supabase
      .from("users")
      .select("plan")
      .eq("id", req.userId)
      .single()

    if (!user) {
      const { data: created } = await supabase
        .from("users")
        .upsert({ id: req.userId, plan: "free" })
        .select("plan")
        .single()
      user = created
    }

    const plan = user?.plan || "free"
    if (!plans.includes(plan)) {
      return res.status(403).json({
        error: "Plan upgrade required",
        current_plan: plan,
      })
    }
    req.userPlan = plan
    next()
  }
}

module.exports = {
  requireJwt,
  requireApiKey,
  requireAuth,
  requirePlan,
}
