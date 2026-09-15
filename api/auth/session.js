"use strict"

/**
 * Session auth.
 *
 * Self-owned HS256 JWTs signed with JWT_SECRET; credentials
 * live on the users row (email + password_hash). There used
 * to be a second mode where tokens were Supabase Auth JWTs
 * and users lived in auth.users; it is gone along with
 * Supabase itself.
 */

const bcrypt = require("bcryptjs")
const jwt = require("jsonwebtoken")
const { db } = require("../db")

const SECRET = process.env.JWT_SECRET
const ACCESS_TTL = process.env.JWT_ACCESS_TTL || "1h"
const REFRESH_TTL = process.env.JWT_REFRESH_TTL || "30d"

if (!SECRET) {
  throw new Error("JWT_SECRET is required")
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
 * Local HS256 verify; no network call.
 */
async function verifyAccess(token) {
  try {
    const p = jwt.verify(token, SECRET)
    if (p.typ !== "access") return null
    return { userId: p.sub, email: p.email || null }
  } catch {
    return null
  }
}

/** Verify a refresh token. */
function verifyRefresh(token) {
  try {
    const p = jwt.verify(token, SECRET)
    if (p.typ !== "refresh") return null
    return { userId: p.sub }
  } catch {
    return null
  }
}

/** Look up a user's email by id. */
async function getUserEmail(userId) {
  const { data } = await db
    .from("users").select("email").eq("id", userId).maybeSingle()
  return data?.email || null
}

module.exports = {
  hashPassword,
  verifyPassword,
  signAccess,
  signRefresh,
  verifyAccess,
  verifyRefresh,
  getUserEmail,
}
