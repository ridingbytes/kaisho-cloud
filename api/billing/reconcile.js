"use strict"

/**
 * Reconcile users.plan from both payment sources.
 *
 * Thin DB wrapper around resolveEffectivePlan(): read the
 * per-source columns, recompute the effective plan, persist
 * it if it changed, and clear the plan caches so gated
 * routes and /auth/me reflect the change on the next
 * request. Every Stripe or Apple handler that changes a
 * grant calls this instead of writing users.plan directly.
 */

const { supabase } = require("../db")
const { clearPlanCache } = require("../middleware")
const { logger } = require("../logger")
const { resolveEffectivePlan } = require("./plans")

/**
 * Recompute and persist the effective plan for one user.
 *
 * @param {string} userId - User UUID.
 * @returns {Promise<string|null>} Effective plan, or null
 *   if the user row is missing.
 */
async function reconcilePlan(userId) {
  const { data: user, error } = await supabase
    .from("users")
    .select("plan, stripe_plan, apple_plan, apple_expires_at")
    .eq("id", userId)
    .maybeSingle()

  if (error) throw error
  if (!user) {
    logger.warn({ userId }, "reconcilePlan: user not found")
    return null
  }

  const effective = resolveEffectivePlan({
    stripePlan: user.stripe_plan,
    applePlan: user.apple_plan,
    appleExpiresAt: user.apple_expires_at,
    now: Date.now(),
  })

  if (effective !== user.plan) {
    await supabase
      .from("users")
      .update({ plan: effective })
      .eq("id", userId)
    logger.info(
      { userId, from: user.plan, to: effective },
      "Plan reconciled",
    )
  }

  // Always clear the caches: the caller just changed a
  // source column, and even when the effective plan is
  // unchanged a stale cache entry could be mid-TTL.
  clearPlanCache(userId)
  return effective
}

module.exports = { reconcilePlan }
