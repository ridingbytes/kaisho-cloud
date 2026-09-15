"use strict"

const crypto = require("crypto")

// ── Data layer ───────────────────────────────────────────

// A PostgreSQL-backed client exposing the small query-builder
// surface the call sites use (.from().select().eq()... plus a
// few rpc names). See db_pg.js.
//
// This was once a switch: DB_BACKEND chose between Supabase
// and this. Supabase is gone — the hosted instance cut over on
// 2026-09-13 and the project was deleted — so Postgres is not
// the default any more, it is the only one.
const db = require("./db_pg").createClient()

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
  db,
  getCachedUser,
  cacheUser,
  invalidateAuthCache,
}
