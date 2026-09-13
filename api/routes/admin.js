"use strict"

/**
 * Admin provisioning API.
 *
 * Guarded by a single ADMIN_API_KEY (Bearer). Intended for the
 * private billing service (kaisho-billing): on payment it
 * provisions an account and receives the sync token to hand to
 * the user; on cancellation it disables the account.
 *
 * postgres mode only — the disable flag lives on the users row
 * in the plain-Postgres schema.
 */

const crypto = require("crypto")
const { Router } = require("express")
const {
  createAccount, generateApiKey, setDisabled,
  setPassword, deleteAccount, listAccounts,
} = require("../services/accounts")
const { asyncHandler } = require("../utils/asyncHandler")

const ADMIN_API_KEY = process.env.ADMIN_API_KEY

/**
 * Require the shared admin key. Fails closed: 503 if unset,
 * 401 on mismatch (timing-safe).
 */
function requireAdmin(req, res, next) {
  if (!ADMIN_API_KEY) {
    return res.status(503).json({ error: "Admin API not configured" })
  }
  const auth = req.headers.authorization
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : ""
  const a = Buffer.from(token)
  const b = Buffer.from(ADMIN_API_KEY)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Unauthorized" })
  }
  next()
}

const router = Router()
router.use(requireAdmin)

// ── GET /admin/accounts ─────────────────────────────────
// List accounts (no secrets).
router.get(
  "/accounts",
  asyncHandler(async (_req, res) => {
    res.json({ accounts: await listAccounts() })
  }),
)

// ── POST /admin/accounts ────────────────────────────────
// Provision an account. Body: { email, password? }.
// Returns { user_id, email, sync_token }.
router.post(
  "/accounts",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {}
    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "email is required" })
    }
    const result = await createAccount({ email, password })
    if (result.error) {
      return res
        .status(result.error.status)
        .json({ error: result.error.message })
    }
    const syncToken = await generateApiKey(result.userId)
    res.status(201).json({
      user_id: result.userId,
      email,
      sync_token: syncToken,
    })
  }),
)

// ── POST /admin/accounts/:id/password ───────────────────
// Reset an account's password. Body: { password }.
router.post(
  "/accounts/:id/password",
  asyncHandler(async (req, res) => {
    const { password } = req.body || {}
    if (!password || typeof password !== "string" ||
      password.length < 8) {
      return res.status(400).json({
        error: "password must be at least 8 characters",
      })
    }
    const { found } = await setPassword(req.params.id, password)
    if (!found) return res.status(404).json({ error: "Not found" })
    res.json({ user_id: req.params.id, password_set: true })
  }),
)

// ── POST /admin/accounts/:id/disable ────────────────────
router.post(
  "/accounts/:id/disable",
  asyncHandler(async (req, res) => {
    const { found } = await setDisabled(req.params.id, true)
    if (!found) return res.status(404).json({ error: "Not found" })
    res.json({ user_id: req.params.id, disabled: true })
  }),
)

// ── POST /admin/accounts/:id/enable ─────────────────────
router.post(
  "/accounts/:id/enable",
  asyncHandler(async (req, res) => {
    const { found } = await setDisabled(req.params.id, false)
    if (!found) return res.status(404).json({ error: "Not found" })
    res.json({ user_id: req.params.id, disabled: false })
  }),
)

// ── DELETE /admin/accounts/:id ──────────────────────────
// Delete an account and all of its synced data.
router.delete(
  "/accounts/:id",
  asyncHandler(async (req, res) => {
    const { found } = await deleteAccount(req.params.id)
    if (!found) return res.status(404).json({ error: "Not found" })
    res.json({ user_id: req.params.id, deleted: true })
  }),
)

// ── POST /admin/accounts/:id/rotate-token ───────────────
// Issue a fresh sync token, invalidating the old one.
router.post(
  "/accounts/:id/rotate-token",
  asyncHandler(async (req, res) => {
    const syncToken = await generateApiKey(req.params.id)
    if (!syncToken) return res.status(404).json({ error: "Not found" })
    res.json({ user_id: req.params.id, sync_token: syncToken })
  }),
)

module.exports = router
