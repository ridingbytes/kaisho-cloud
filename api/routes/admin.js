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
} = require("../services/accounts")
const { OWN_AUTH } = require("../auth/session")
const { asyncHandler } = require("../utils/asyncHandler")

const ADMIN_API_KEY = process.env.ADMIN_API_KEY

/**
 * Require the shared admin key. Fails closed: 503 if unset,
 * 501 outside postgres mode, 401 on mismatch (timing-safe).
 */
function requireAdmin(req, res, next) {
  if (!OWN_AUTH) {
    return res.status(501).json({
      error: "Admin provisioning requires DB_BACKEND=postgres",
    })
  }
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
