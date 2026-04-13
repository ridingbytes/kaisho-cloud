"use strict"

const bcrypt = require("bcrypt")
const { logger } = require("./logger")
const {
  supabase,
  getCachedUser,
  cacheUser,
} = require("./db")

// ── JWT auth (mobile users via Supabase Auth) ────────────

async function requireJwt(req, res, next) {
  const auth = req.headers.authorization
  if (!auth?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" })
  }
  const token = auth.slice(7)

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user) {
    return res.status(401).json({ error: "Invalid token" })
  }

  req.userId = data.user.id
  req.userEmail = data.user.email
  next()
}

// ── API key auth (local sync client) ─────────────────────

async function requireApiKey(req, res, next) {
  const auth = req.headers.authorization
  if (!auth?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" })
  }
  const apiKey = auth.slice(7)

  // Fetch all users with an api_key_hash and try each.
  // With a small user base this is fine. For scale,
  // the cache avoids repeated bcrypt on every request.
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

// ── Combined auth (JWT or API key) ───────────────────────

async function requireAuth(req, res, next) {
  const auth = req.headers.authorization
  if (!auth?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" })
  }

  const token = auth.slice(7)

  // Try JWT first (short tokens are likely API keys)
  if (token.length > 50) {
    const { data, error } =
      await supabase.auth.getUser(token)
    if (!error && data?.user) {
      req.userId = data.user.id
      req.userEmail = data.user.email
      return next()
    }
  }

  // Fall back to API key
  return requireApiKey(req, res, next)
}

// ── Plan enforcement ─────────────────────────────────────

function requirePlan(...plans) {
  return async (req, res, next) => {
    const { data: user } = await supabase
      .from("users")
      .select("plan")
      .eq("id", req.userId)
      .single()

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
