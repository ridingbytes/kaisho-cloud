"use strict"

/**
 * Validate a verified Apple transaction payload and derive
 * the plan grant. Pure — takes an already-JWS-verified
 * payload (see jws.js) plus config, returns a grant or
 * throws AppleTransactionError. No DB, no crypto.
 *
 * Apple's JWSTransactionDecodedPayload fields used here:
 *   bundleId, productId, originalTransactionId,
 *   expiresDate (ms epoch), revocationDate (ms epoch),
 *   environment ("Production" | "Sandbox").
 */

const { planFromAppleProduct } = require("./products")

/**
 * A rejected transaction, with a stable machine code and an
 * HTTP status the route can pass straight through.
 */
class AppleTransactionError extends Error {
  /**
   * @param {string} code - Stable reason code.
   * @param {string} message - Human-readable detail.
   * @param {number} [status] - HTTP status (default 400).
   */
  constructor(code, message, status = 400) {
    super(message)
    this.name = "AppleTransactionError"
    this.code = code
    this.status = status
  }
}

/**
 * Turn a verified transaction payload into a plan grant.
 *
 * @param {object} payload - Verified transaction payload.
 * @param {object} opts
 * @param {string} opts.bundleId - Expected bundle id.
 * @param {string[]} opts.environments - Accepted environments.
 * @param {number} [opts.now] - Unix ms (injected for tests).
 * @returns {{
 *   plan: string,
 *   originalTransactionId: string,
 *   productId: string,
 *   expiresAt: string|null,
 *   environment: string,
 * }}
 * @throws {AppleTransactionError}
 */
function processAppleTransaction(payload, {
  bundleId,
  environments,
  now = Date.now(),
}) {
  if (!payload || typeof payload !== "object") {
    throw new AppleTransactionError(
      "malformed", "Empty transaction payload",
    )
  }

  if (payload.bundleId !== bundleId) {
    throw new AppleTransactionError(
      "wrong_bundle_id",
      `Bundle id ${payload.bundleId} not accepted`,
    )
  }

  if (!environments.includes(payload.environment)) {
    throw new AppleTransactionError(
      "wrong_environment",
      `Environment ${payload.environment} not accepted`,
    )
  }

  const plan = planFromAppleProduct(payload.productId)
  if (!plan) {
    throw new AppleTransactionError(
      "unknown_product",
      `Unknown product ${payload.productId}`,
    )
  }

  const originalTransactionId = payload.originalTransactionId
  if (!originalTransactionId) {
    throw new AppleTransactionError(
      "missing_original_txn", "No originalTransactionId",
    )
  }

  // A refund / revocation invalidates the grant outright.
  if (payload.revocationDate) {
    throw new AppleTransactionError(
      "revoked", "Transaction was revoked", 409,
    )
  }

  // Auto-renewable subscriptions carry expiresDate. Treat a
  // past expiry as no grant. (A non-subscription product
  // would omit expiresDate; we only sell subscriptions, so
  // require it.)
  if (!payload.expiresDate) {
    throw new AppleTransactionError(
      "not_subscription", "Transaction has no expiry", 400,
    )
  }
  if (payload.expiresDate <= now) {
    throw new AppleTransactionError(
      "expired", "Subscription already expired", 409,
    )
  }

  return {
    plan,
    originalTransactionId: String(originalTransactionId),
    productId: payload.productId,
    expiresAt: new Date(payload.expiresDate).toISOString(),
    environment: payload.environment,
  }
}

module.exports = {
  AppleTransactionError,
  processAppleTransaction,
}
