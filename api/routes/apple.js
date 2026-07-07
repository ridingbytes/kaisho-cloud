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
const { supabase } = require("../db")
const { logger } = require("../logger")
const { asyncHandler } = require("../utils/asyncHandler")
const {
  validate, appleVerifySchema, appleNotificationSchema,
} = require("../validation")
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
  refreshAppleGrant, revokeAppleGrant,
} = require("../billing/apple/store")
const {
  interpretNotification,
} = require("../billing/apple/notifications")

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

// ── POST /billing/apple/notifications ───────────────────

/**
 * Verify a nested JWS from a notification, or null when the
 * field is absent (e.g. a TEST notification carries none).
 *
 * @param {string|undefined} jws
 * @param {import("crypto").X509Certificate[]} roots
 * @returns {object|null}
 */
function verifyNested(jws, roots) {
  if (!jws) return null
  return verifyAppleJws(jws, { trustedRoots: roots })
}

/**
 * Apply a verified notification to the user's Apple grant.
 *
 * @param {object} notification - Verified outer payload.
 * @param {import("crypto").X509Certificate[]} roots
 */
async function applyNotification(notification, roots) {
  const data = notification.data || {}
  const txn = verifyNested(data.signedTransactionInfo, roots)
  const renewal = verifyNested(data.signedRenewalInfo, roots)

  const result = interpretNotification({
    notificationType: notification.notificationType,
    txn,
    renewal,
    bundleId: APPLE_BUNDLE_ID,
    now: Date.now(),
  })

  if (result.action === "ignore") {
    logger.info(
      { type: notification.notificationType, reason: result.reason },
      "Apple notification ignored",
    )
    return
  }
  if (result.action === "revoke") {
    await revokeAppleGrant(result.originalTransactionId)
    return
  }
  await refreshAppleGrant(result.grant)
}

/**
 * Receive App Store Server Notifications V2.
 *
 * Unauthenticated by design — Apple's servers call it. Trust
 * comes from the JWS signature, not a session. At-least-once
 * delivery is de-duplicated by claiming notificationUUID in
 * apple_notifications first (migration 024), mirroring the
 * Stripe webhook.
 *
 * @route POST /billing/apple/notifications
 */
router.post(
  "/notifications",
  apiLimiter,
  validate(appleNotificationSchema),
  asyncHandler(async (req, res) => {
    const roots = getTrustedRoots()
    if (!roots) {
      return res.status(503).json({
        error: "Apple verification is not configured",
      })
    }

    let notification
    try {
      notification = verifyAppleJws(req.body.signedPayload, {
        trustedRoots: roots,
      })
    } catch (err) {
      logger.warn(
        { err: err.message },
        "Apple notification verification failed",
      )
      return res.status(400).json({ error: "invalid_signature" })
    }

    const uuid = notification.notificationUUID
    if (!uuid) {
      return res.status(400).json({ error: "missing_uuid" })
    }

    // Claim the notification by inserting its UUID first; the
    // primary key makes this the atomic idempotency lock.
    const { error: claimErr } = await supabase
      .from("apple_notifications")
      .insert({
        notification_uuid: uuid,
        notification_type: notification.notificationType,
        subtype: notification.subtype || null,
      })

    if (claimErr) {
      if (claimErr.code === "23505") {
        return res.json({ received: true, duplicate: true })
      }
      logger.error(
        { err: claimErr, uuid },
        "Failed to record Apple notification",
      )
      return res.status(500).json({
        error: "Could not record notification",
      })
    }

    try {
      await applyNotification(notification, roots)
    } catch (err) {
      // Release the claim so Apple's redelivery reprocesses
      // instead of seeing the row and skipping forever.
      await supabase
        .from("apple_notifications")
        .delete()
        .eq("notification_uuid", uuid)
      throw err
    }

    res.json({ received: true })
  }),
)

module.exports = router
