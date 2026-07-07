"use strict"

/**
 * Persistence for Apple in-app-purchase grants.
 *
 * Writes only the per-source apple_* columns, then defers to
 * reconcilePlan() to recompute users.plan. That keeps the
 * "an active sub from either source grants the plan" rule in
 * one place and out of every call site.
 */

const { supabase } = require("../../db")
const { logger } = require("../../logger")
const { reconcilePlan } = require("../reconcile")

/**
 * Raised when an Apple original_transaction_id is already
 * linked to a different user (family sharing, or a second
 * account restoring the same purchase).
 */
class AppleLinkConflictError extends Error {
  constructor(message) {
    super(message)
    this.name = "AppleLinkConflictError"
    this.code = "already_linked"
    this.status = 409
  }
}

/**
 * Find the user a subscription is linked to.
 *
 * @param {string} originalTransactionId
 * @returns {Promise<string|null>} User id or null.
 */
async function findUserByOriginalTxn(originalTransactionId) {
  const { data } = await supabase
    .from("users")
    .select("id")
    .eq("apple_original_transaction_id", originalTransactionId)
    .maybeSingle()
  return data?.id || null
}

/**
 * Link (or refresh) an Apple subscription on a user and
 * reconcile the effective plan.
 *
 * @param {string} userId - User UUID.
 * @param {object} grant - From processAppleTransaction().
 * @returns {Promise<string>} The reconciled effective plan.
 * @throws {AppleLinkConflictError} if linked elsewhere.
 */
async function linkAppleSubscription(userId, grant) {
  const owner = await findUserByOriginalTxn(
    grant.originalTransactionId,
  )
  if (owner && owner !== userId) {
    throw new AppleLinkConflictError(
      "This purchase is already linked to another account",
    )
  }

  const { error } = await supabase
    .from("users")
    .update({
      apple_original_transaction_id: grant.originalTransactionId,
      apple_product_id: grant.productId,
      apple_plan: grant.plan,
      apple_expires_at: grant.expiresAt,
      apple_environment: grant.environment,
    })
    .eq("id", userId)
  if (error) throw error

  const effective = await reconcilePlan(userId)
  logger.info(
    {
      userId,
      plan: grant.plan,
      product: grant.productId,
      effective,
    },
    "Apple subscription linked",
  )
  return effective
}

/**
 * Refresh an Apple grant from a notification (renew, change,
 * grace). Finds the user by the original transaction id —
 * the /verify call linked it first — and updates the apple_*
 * columns, then reconciles.
 *
 * @param {object} grant - From interpretNotification().
 * @returns {Promise<string|null>} Effective plan, or null if
 *   no user owns this subscription yet.
 */
async function refreshAppleGrant(grant) {
  const userId = await findUserByOriginalTxn(
    grant.originalTransactionId,
  )
  if (!userId) {
    logger.warn(
      { originalTransactionId: grant.originalTransactionId },
      "Apple notification for unknown subscription",
    )
    return null
  }

  const { error } = await supabase
    .from("users")
    .update({
      apple_product_id: grant.productId,
      apple_plan: grant.plan,
      apple_expires_at: grant.expiresAt,
      apple_environment: grant.environment,
    })
    .eq("id", userId)
  if (error) throw error

  const effective = await reconcilePlan(userId)
  logger.info(
    { userId, plan: grant.plan, effective },
    "Apple grant refreshed",
  )
  return effective
}

/**
 * Revoke an Apple grant (expiry, refund, revoke). Clears the
 * apple_plan / apple_expires_at so reconciliation drops the
 * Apple contribution, then reconciles — which keeps any
 * still-active Stripe plan. The original transaction id and
 * product are kept for audit and possible re-linking.
 *
 * @param {string} originalTransactionId
 * @returns {Promise<string|null>} Effective plan, or null.
 */
async function revokeAppleGrant(originalTransactionId) {
  const userId = await findUserByOriginalTxn(
    originalTransactionId,
  )
  if (!userId) {
    logger.warn(
      { originalTransactionId },
      "Apple revoke for unknown subscription",
    )
    return null
  }

  const { error } = await supabase
    .from("users")
    .update({ apple_plan: null, apple_expires_at: null })
    .eq("id", userId)
  if (error) throw error

  const effective = await reconcilePlan(userId)
  logger.info(
    { userId, effective },
    "Apple grant revoked",
  )
  return effective
}

module.exports = {
  AppleLinkConflictError,
  findUserByOriginalTxn,
  linkAppleSubscription,
  refreshAppleGrant,
  revokeAppleGrant,
}
