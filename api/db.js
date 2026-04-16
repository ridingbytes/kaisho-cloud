"use strict"

const crypto = require("crypto")
const { createClient } = require("@supabase/supabase-js")

// ── Supabase client ──────────────────────────────────────

// persistSession: false prevents the client from tracking
// user sessions after auth.signInWithPassword calls — without
// this, subsequent queries use the signed-in user's JWT (subject
// to RLS) instead of the service_role key.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  },
)

// ── Auth cache ───────────────────────────────────────────
// Bcrypt comparison takes ~100 ms. Cache positive auth
// results for 60 s so sync requests don't pay that cost.

const AUTH_CACHE = new Map()
const AUTH_CACHE_TTL = 60_000

function authCacheKey(userId, apiKey) {
  return crypto
    .createHash("sha256")
    .update(`${userId}:${apiKey}`)
    .digest("hex")
}

function getCachedUser(userId, apiKey) {
  const key = authCacheKey(userId, apiKey)
  const entry = AUTH_CACHE.get(key)
  if (!entry) return null
  if (Date.now() - entry.ts > AUTH_CACHE_TTL) {
    AUTH_CACHE.delete(key)
    return null
  }
  return entry.user
}

function cacheUser(userId, apiKey, user) {
  AUTH_CACHE.set(
    authCacheKey(userId, apiKey),
    { user, ts: Date.now() },
  )
}

function invalidateAuthCache(userId) {
  for (const [key, entry] of AUTH_CACHE.entries()) {
    if (entry.user.id === userId) {
      AUTH_CACHE.delete(key)
    }
  }
}

module.exports = {
  supabase,
  AUTH_CACHE,
  authCacheKey,
  getCachedUser,
  cacheUser,
  invalidateAuthCache,
}
