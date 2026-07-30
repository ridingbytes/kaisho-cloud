"use strict"

/**
 * Backend-aware session auth.
 *
 * Two modes, selected by DB_BACKEND (same switch as the data
 * layer in db.js):
 *   supabase (default) - tokens are Supabase Auth JWTs, verified
 *                        by supabaseAuth; users live in auth.users.
 *   postgres           - self-owned HS256 JWTs signed with
 *                        JWT_SECRET; credentials live on the
 *                        users row (email + password_hash).
 *
 * This module hides that split so the routes / middleware call
 * one set of functions. Auth stays on Supabase until an
 * instance runs DB_BACKEND=postgres, at which point it needs
 * no Supabase at all.
 */

const bcrypt = require("bcryptjs")
const jwt = require("jsonwebtoken")
const { supabase, supabaseAuth } = require("../db")

const OWN_AUTH = (process.env.DB_BACKEND || "supabase") === "postgres"
const SECRET = process.env.JWT_SECRET
const ACCESS_TTL = process.env.JWT_ACCESS_TTL || "1h"
const REFRESH_TTL = process.env.JWT_REFRESH_TTL || "30d"

if (OWN_AUTH && !SECRET) {
  throw new Error(
    "JWT_SECRET is required when DB_BACKEND=postgres",
  )
}

function hashPassword(password) {
  return bcrypt.hash(password, 10)
}

function verifyPassword(password, hash) {
  if (!hash) return Promise.resolve(false)
  return bcrypt.compare(password, hash)
}

function signAccess(userId, email) {
  return jwt.sign(
    { sub: userId, email, typ: "access" },
    SECRET, { expiresIn: ACCESS_TTL },
  )
}

function signRefresh(userId) {
  return jwt.sign(
    { sub: userId, typ: "refresh" },
    SECRET, { expiresIn: REFRESH_TTL },
  )
}

/**
 * Verify an access token. Returns { userId, email } or null.
 * postgres: local HS256 verify. supabase: supabaseAuth.getUser.
 */
async function verifyAccess(token) {
  if (OWN_AUTH) {
    try {
      const p = jwt.verify(token, SECRET)
      if (p.typ !== "access") return null
      return { userId: p.sub, email: p.email || null }
    } catch {
      return null
    }
  }
  const { data, error } = await supabaseAuth.auth.getUser(token)
  if (error || !data?.user) return null
  return { userId: data.user.id, email: data.user.email }
}

/** Verify a self-owned refresh token. postgres mode only. */
function verifyRefresh(token) {
  try {
    const p = jwt.verify(token, SECRET)
    if (p.typ !== "refresh") return null
    return { userId: p.sub }
  } catch {
    return null
  }
}

/** Look up a user's email by id, from whichever store holds it. */
async function getUserEmail(userId) {
  if (OWN_AUTH) {
    const { data } = await supabase
      .from("users").select("email").eq("id", userId).maybeSingle()
    return data?.email || null
  }
  const { data } = await supabase.auth.admin.getUserById(userId)
  return data?.user?.email || null
}

module.exports = {
  OWN_AUTH,
  hashPassword,
  verifyPassword,
  signAccess,
  signRefresh,
  verifyAccess,
  verifyRefresh,
  getUserEmail,
}
