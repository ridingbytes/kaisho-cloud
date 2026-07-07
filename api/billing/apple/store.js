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

module.exports = {
  AppleLinkConflictError,
  findUserByOriginalTxn,
  linkAppleSubscription,
}
