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

// DB_BACKEND selects the data layer:
//   "supabase" (default) - supabase-js against Supabase Postgres
//   "postgres"           - the pg query shim against DATABASE_URL
// Auth (supabaseAuth) still uses Supabase until the self-owned
// auth lands, so Supabase env stays required for now.
const DB_BACKEND = process.env.DB_BACKEND || "supabase"

const supabase = DB_BACKEND === "postgres"
  ? require("./db_pg").createClient()
  : createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    clientOpts,
  )

// Only needed in supabase mode (login / refresh / getUser).
// In postgres mode auth is self-owned, so skip it — the
// Supabase env is not even present then.
const supabaseAuth = DB_BACKEND === "postgres"
  ? null
  : createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    clientOpts,
  )

// ── Auth cache ───────────────────────────────────────────
// Bcrypt comparison takes ~100 ms. The fast key-hash
// cache lets recently-seen API keys skip bcrypt entirely
// for ``AUTH_CACHE_TTL`` (5 minutes).
//
// History: this used to be a two-cache structure (the
// userId-keyed AUTH_CACHE alongside the fast key cache).
// The userId cache was unreachable -- every caller passed
// userId=null -- so it served zero traffic on the read
// path and silently leaked entries on the write path.
// Removed per #78.

const API_KEY_CACHE = new Map()
const AUTH_CACHE_TTL = 300_000  // 5 minutes

function getCachedUser(apiKey) {
  const keyHash = crypto
    .createHash("sha256")
    .update(apiKey)
    .digest("hex")
  const entry = API_KEY_CACHE.get(keyHash)
  if (!entry) return null
  if (Date.now() - entry.ts > AUTH_CACHE_TTL) {
    API_KEY_CACHE.delete(keyHash)
    return null
  }
  return entry.user
}

function cacheUser(apiKey, user) {
  const keyHash = crypto
    .createHash("sha256")
    .update(apiKey)
    .digest("hex")
  API_KEY_CACHE.set(keyHash, { user, ts: Date.now() })
}

function invalidateAuthCache(userId) {
  for (const [key, entry] of API_KEY_CACHE.entries()) {
    if (entry.user.id === userId) {
      API_KEY_CACHE.delete(key)
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
