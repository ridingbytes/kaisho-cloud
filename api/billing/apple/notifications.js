"use strict"

/**
 * Interpret App Store Server Notifications V2.
 *
 * Pure decision logic: given an already-verified notification
 * type plus the (already JWS-verified) transaction and
 * renewal payloads, decide whether the Apple grant should be
 * refreshed, revoked, or ignored. No DB, no crypto — the
 * route does the verification and applies the result via
 * api/billing/apple/store.js.
 *
 * Apple notification reference (V2):
 *   https://developer.apple.com/documentation/appstoreservernotifications
 */

const { planFromAppleProduct } = require("./products")

// Types that end the entitlement outright.
const REVOKE_TYPES = new Set([
  "EXPIRED",
  "REFUND",
  "REVOKE",
  "GRACE_PERIOD_EXPIRED",
])

/**
 * Latest instant the Apple grant should stay valid: the
 * transaction's expiry, extended to the end of a billing
 * grace period when one is in effect.
 *
 * @param {object} txn - Verified transaction payload.
 * @param {object|null} renewal - Verified renewal payload.
 * @returns {number} Unix ms, or 0 when unknown.
 */
function grantExpiry(txn, renewal) {
  const candidates = [txn && txn.expiresDate]
  if (renewal && renewal.gracePeriodExpiresDate) {
    candidates.push(renewal.gracePeriodExpiresDate)
  }
  const valid = candidates.filter((n) => typeof n === "number")
  return valid.length ? Math.max(...valid) : 0
}

/**
 * Decide what a notification means for the user's plan.
 *
 * @param {object} params
 * @param {string} params.notificationType
 * @param {object|null} params.txn - Verified transaction.
 * @param {object|null} params.renewal - Verified renewal.
 * @param {string} params.bundleId - Expected bundle id.
 * @param {number} params.now - Unix ms.
 * @returns {
 *   {action: "ignore", reason: string} |
 *   {action: "revoke", originalTransactionId: string} |
 *   {action: "refresh", grant: object}
 * }
 */
function interpretNotification({
  notificationType,
  txn,
  renewal,
  bundleId,
  now,
}) {
  if (!txn) {
    return { action: "ignore", reason: "no_transaction" }
  }
  if (txn.bundleId && txn.bundleId !== bundleId) {
    return { action: "ignore", reason: "wrong_bundle_id" }
  }

  const originalTransactionId = txn.originalTransactionId
    ? String(txn.originalTransactionId)
    : null
  if (!originalTransactionId) {
    return { action: "ignore", reason: "no_original_txn" }
  }

  if (REVOKE_TYPES.has(notificationType)) {
    return { action: "revoke", originalTransactionId }
  }

  const plan = planFromAppleProduct(txn.productId)
  if (!plan) {
    return { action: "ignore", reason: "unknown_product" }
  }

  // Everything else (SUBSCRIBED, DID_RENEW, OFFER_REDEEMED,
  // DID_CHANGE_RENEWAL_STATUS/PREF, DID_FAIL_TO_RENEW with a
  // grace period, …) keeps access alive until the current
  // period — or grace period — ends. Sync the expiry from
  // Apple's own transaction; if that instant has already
  // passed and no grace extends it, drop the grant.
  const expiresMs = grantExpiry(txn, renewal)
  if (!expiresMs || expiresMs <= now) {
    return { action: "revoke", originalTransactionId }
  }

  return {
    action: "refresh",
    grant: {
      originalTransactionId,
      plan,
      productId: txn.productId,
      expiresAt: new Date(expiresMs).toISOString(),
      environment: txn.environment,
    },
  }
}

module.exports = {
  REVOKE_TYPES,
  grantExpiry,
  interpretNotification,
}
