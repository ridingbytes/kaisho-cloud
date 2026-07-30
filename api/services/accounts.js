"use strict"

/**
 * Account provisioning shared by public signup and the admin
 * API. Backend-aware via OWN_AUTH: postgres creates a
 * self-owned users row (email + bcrypt password_hash); supabase
 * creates a Supabase Auth user plus a users row.
 *
 * The "sync token" a user pastes into the desktop app is just
 * the account's API key, minted by generateApiKey().
 */

const crypto = require("crypto")
const bcrypt = require("bcryptjs")
const { supabase, invalidateAuthCache } = require("../db")
const { OWN_AUTH, hashPassword } = require("../auth/session")

/**
 * Create an account. Returns { userId } or
 * { error: { status, message } }. Password is optional (a
 * provisioned account may authenticate with its sync token
 * only until the user sets a password).
 */
async function createAccount({ email, password }) {
  return OWN_AUTH
    ? createOwnAccount(email, password)
    : createSupabaseAccount(email, password)
}

async function createOwnAccount(email, password) {
  const row = { email, plan: "free" }
  if (password) row.password_hash = await hashPassword(password)
  const { data, error } = await supabase
    .from("users").insert(row).select("id").single()
  if (error) {
    if (error.code === "23505") {
      return conflict()
    }
    return failure()
  }
  return { userId: data.id }
}

async function createSupabaseAccount(email, password) {
  const { data, error } = await supabase.auth.admin.createUser({
    email, password, email_confirm: true,
  })
  if (error) {
    if (error.message.includes("already")) return conflict()
    return failure()
  }
  const userId = data.user.id
  await supabase.from("users").insert({ id: userId, plan: "free" })
  return { userId }
}

function conflict() {
  return { error: { status: 409, message: "Email already registered" } }
}

function failure() {
  return { error: { status: 500, message: "Could not create account" } }
}

/**
 * Mint a new API key (sync token) for an account, replacing any
 * existing one. Returns the plaintext key, or null if the user
 * does not exist.
 */
async function generateApiKey(userId) {
  const apiKey = crypto.randomUUID()
  const keyHash = await bcrypt.hash(apiKey, 10)
  const { data } = await supabase
    .from("users")
    .update({ api_key_hash: keyHash, api_key_prefix: apiKey.slice(0, 8) })
    .eq("id", userId)
    .select("id")
    .maybeSingle()
  invalidateAuthCache(userId)
  return data ? apiKey : null
}

/**
 * Enable or disable an account. Disabling stamps disabled_at
 * and clears the auth cache so the API key stops working at
 * once. Returns { found }.
 */
async function setDisabled(userId, disabled) {
  const { data } = await supabase
    .from("users")
    .update({ disabled_at: disabled ? new Date().toISOString() : null })
    .eq("id", userId)
    .select("id")
    .maybeSingle()
  invalidateAuthCache(userId)
  return { found: !!data }
}

module.exports = {
  createAccount,
  generateApiKey,
  setDisabled,
}
