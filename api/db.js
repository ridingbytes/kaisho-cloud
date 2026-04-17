"use strict"

const crypto = require("crypto")
const { createClient } = require("@supabase/supabase-js")

// ── Supabase client ──────────────────────────────────────

// Two clients, because supabase-js tracks the current user
// session internally on a single client. Calling
// auth.signInWithPassword() on a shared client causes later
// .from().select() queries to send the user's JWT (subject to
// RLS) instead of the service_role key, returning 0 rows.
//
// - supabase:     service-role-only, for DB and auth.admin ops
// - supabaseAuth: for auth.signInWithPassword and refreshSession
const clientOpts = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  clientOpts,
)

const supabaseAuth = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  clientOpts,
)

// ── Auth cache ───────────────────────────────────────────
// Bcrypt comparison takes ~100 ms. Cache positive auth
// results for 5 minutes so sync requests don't pay that
// cost. A fast SHA-256 key cache provides O(1) lookups
// that skip bcrypt entirely for recently-seen API keys.

const AUTH_CACHE = new Map()
const AUTH_CACHE_TTL = 300_000  // 5 minutes

function authCacheKey(userId, apiKey) {
  return crypto
    .createHash("sha256")
    .update(`${userId}:${apiKey}`)
    .digest("hex")
}

// Fast lookup: hash(apiKey) -> user (skips bcrypt)
const API_KEY_CACHE = new Map()

function getCachedUser(userId, apiKey) {
  // Try fast key-only cache first
  const keyHash = crypto
    .createHash("sha256")
    .update(apiKey)
    .digest("hex")
  const fast = API_KEY_CACHE.get(keyHash)
  if (fast && Date.now() - fast.ts < AUTH_CACHE_TTL) {
    return fast.user
  }

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
  const now = Date.now()
  AUTH_CACHE.set(
    authCacheKey(userId, apiKey),
    { user, ts: now },
  )
  // Also cache by API key hash for fast O(1) lookup
  // that skips the bcrypt comparison entirely.
  const keyHash = crypto
    .createHash("sha256")
    .update(apiKey)
    .digest("hex")
  API_KEY_CACHE.set(keyHash, { user, ts: now })
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
  supabaseAuth,
  getCachedUser,
  cacheUser,
  invalidateAuthCache,
}
