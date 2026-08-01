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

/**
 * Set (reset) an account's password. Returns { found }.
 * postgres/own-auth only — supabase mode stores passwords in
 * Supabase Auth, not on the users row.
 */
async function setPassword(userId, password) {
  const passwordHash = await hashPassword(password)
  const { data } = await supabase
    .from("users")
    .update({ password_hash: passwordHash })
    .eq("id", userId)
    .select("id")
    .maybeSingle()
  invalidateAuthCache(userId)
  return { found: !!data }
}

/**
 * Delete an account and (via ON DELETE CASCADE) all of its
 * synced data. Returns { found }.
 */
async function deleteAccount(userId) {
  const { data } = await supabase
    .from("users")
    .delete()
    .eq("id", userId)
    .select("id")
    .maybeSingle()
  invalidateAuthCache(userId)
  return { found: !!data }
}

/** Per-account sync stats keyed by user id. postgres only. */
async function accountStats() {
  const { rows } = await supabase.raw(
    "SELECT u.id," +
    " count(c.id) FILTER (WHERE c.deleted_at IS NULL)" +
    "   AS clock_entries," +
    " max(c.updated_at) AS last_change_at," +
    " (SELECT count(*) FROM tasks t" +
    "  WHERE t.user_id = u.id AND t.deleted_at IS NULL) AS tasks," +
    " (SELECT count(*) FROM notes n" +
    "  WHERE n.user_id = u.id AND n.deleted_at IS NULL) AS notes" +
    " FROM users u LEFT JOIN clock_entries c ON c.user_id = u.id" +
    " GROUP BY u.id",
  )
  const map = {}
  for (const r of rows) {
    map[r.id] = {
      clock_entries: Number(r.clock_entries),
      tasks: Number(r.tasks),
      notes: Number(r.notes),
      last_change_at: r.last_change_at,
    }
  }
  return map
}

/**
 * List accounts for the admin API, enriched with sync stats
 * (postgres backend). Never includes password hashes or keys.
 */
async function listAccounts() {
  const { data } = await supabase
    .from("users")
    .select("id, email, plan, disabled_at, created_at")
    .order("created_at", { ascending: true })
  const accounts = data || []
  if (typeof supabase.raw !== "function") return accounts
  const stats = await accountStats()
  return accounts.map((a) => ({
    ...a,
    clock_entries: 0, tasks: 0, notes: 0, last_change_at: null,
    ...(stats[a.id] || {}),
  }))
}

module.exports = {
  createAccount,
  generateApiKey,
  setDisabled,
  setPassword,
  deleteAccount,
  listAccounts,
}
