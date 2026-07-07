"use strict"

/**
 * Apple App Store routes (iOS in-app purchases).
 *
 * iOS-only: the web PWA never touches these. After a
 * StoreKit 2 purchase the app POSTs the signed transaction
 * here; the server verifies Apple's signature, maps the
 * product to a plan, and grants it. Nothing here trusts a
 * client-sent plan value — entitlement comes only from a
 * transaction Apple signed.
 */

const { Router } = require("express")
const { requireJwt } = require("../middleware")
const { apiLimiter } = require("../config")
const { logger } = require("../logger")
const { asyncHandler } = require("../utils/asyncHandler")
const { validate, appleVerifySchema } = require("../validation")
const {
  verifyAppleJws, loadTrustedRoots,
} = require("../billing/apple/jws")
const {
  APPLE_BUNDLE_ID, APPLE_ENVIRONMENTS,
} = require("../billing/apple/config")
const {
  processAppleTransaction, AppleTransactionError,
} = require("../billing/apple/transaction")
const {
  linkAppleSubscription, AppleLinkConflictError,
} = require("../billing/apple/store")

const router = Router()

// Apple's root CA(s), loaded once from disk on first use.
// Cached so we don't re-read the file per request; null
// means "not configured", which surfaces as a 503 rather
// than crashing the server at startup (dev has no cert).
let cachedRoots = null

/**
 * Return the pinned Apple roots, loading them on first call.
 *
 * @returns {import("crypto").X509Certificate[]|null}
 */
function getTrustedRoots() {
  if (cachedRoots) return cachedRoots
  try {
    cachedRoots = loadTrustedRoots()
  } catch (err) {
    logger.error(
      { err: err.message },
      "Apple root CA not configured",
    )
    return null
  }
  return cachedRoots
}

// ── POST /billing/apple/verify ──────────────────────────

/**
 * Verify a StoreKit 2 transaction and grant the plan.
 *
 * Body: { signedTransaction }. Free users may call this —
 * it is how they subscribe on iOS.
 *
 * @route POST /billing/apple/verify
 */
router.post(
  "/verify",
  requireJwt,
  apiLimiter,
  validate(appleVerifySchema),
  asyncHandler(async (req, res) => {
    const roots = getTrustedRoots()
    if (!roots) {
      return res.status(503).json({
        error: "Apple verification is not configured",
      })
    }

    let payload
    try {
      payload = verifyAppleJws(req.body.signedTransaction, {
        trustedRoots: roots,
      })
    } catch (err) {
      // Signature / chain failure. Log the reason, but tell
      // the client only that it was rejected.
      logger.warn(
        { err: err.message, userId: req.userId },
        "Apple JWS verification failed",
      )
      return res.status(400).json({
        error: "invalid_signature",
      })
    }

    let grant
    try {
      grant = processAppleTransaction(payload, {
        bundleId: APPLE_BUNDLE_ID,
        environments: APPLE_ENVIRONMENTS,
      })
    } catch (err) {
      if (err instanceof AppleTransactionError) {
        return res.status(err.status).json({
          error: err.code,
        })
      }
      throw err
    }

    let effective
    try {
      effective = await linkAppleSubscription(
        req.userId, grant,
      )
    } catch (err) {
      if (err instanceof AppleLinkConflictError) {
        return res.status(err.status).json({
          error: err.code,
        })
      }
      throw err
    }

    res.json({
      plan: grant.plan,
      effective_plan: effective,
      expires_at: grant.expiresAt,
      environment: grant.environment,
    })
  }),
)

module.exports = router
