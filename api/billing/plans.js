"use strict"

/**
 * Plan tiers and cross-source reconciliation.
 *
 * users.plan is the single effective plan the API enforces.
 * It is never written directly by a payment handler; each
 * source (Stripe web, Apple iOS) records its own grant and
 * resolveEffectivePlan() recomputes the effective plan as
 * the highest active tier across both. That way an active
 * subscription from either source grants the plan, and one
 * source expiring never wipes a plan the other still grants.
 *
 * Pure functions only — no DB, no side effects — so the
 * reconciliation rules are unit-testable in isolation. The
 * DB wrapper lives in api/billing/reconcile.js.
 */

// Ordered so a higher tier wins when two sources disagree.
const PLAN_RANK = { free: 0, companion: 1, pro: 2, team: 3 }

/**
 * Numeric rank of a plan; unknown / null → free (0).
 *
 * @param {string|null|undefined} plan
 * @returns {number}
 */
function planRank(plan) {
  return PLAN_RANK[plan] ?? 0
}

/**
 * The higher of two plans. Null / unknown collapse to free.
 *
 * @param {string|null} a
 * @param {string|null} b
 * @returns {string} One of free|companion|pro|team.
 */
function maxPlan(a, b) {
  return planRank(a) >= planRank(b) ? (a || "free") : (b || "free")
}

/**
 * Resolve the effective plan from both payment sources.
 *
 * Stripe's contribution is authoritative-as-set: the Stripe
 * webhook clears users.stripe_plan on cancellation, so a
 * non-null value means Stripe currently grants that tier.
 *
 * Apple's contribution is time-boxed: it counts only while
 * apple_expires_at is in the future. This makes the resolve
 * correct even if an EXPIRED notification is late or never
 * arrives — the grant simply stops counting at expiry.
 *
 * @param {object} p
 * @param {string|null} p.stripePlan - users.stripe_plan.
 * @param {string|null} p.applePlan - users.apple_plan.
 * @param {string|Date|null} p.appleExpiresAt
 * @param {number} p.now - Unix ms (injected for tests).
 * @returns {string} Effective plan (free by default).
 */
function resolveEffectivePlan({
  stripePlan,
  applePlan,
  appleExpiresAt,
  now,
}) {
  const appleActive =
    !!applePlan &&
    !!appleExpiresAt &&
    new Date(appleExpiresAt).getTime() > now
  const appleContribution = appleActive ? applePlan : null
  return maxPlan(stripePlan || null, appleContribution)
}

module.exports = {
  PLAN_RANK,
  planRank,
  maxPlan,
  resolveEffectivePlan,
}
