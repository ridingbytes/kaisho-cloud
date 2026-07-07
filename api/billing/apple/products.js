"use strict"

/**
 * Apple App Store product id → Kaisho plan.
 *
 * The App Store Connect product ids are configurable via
 * env so a different App Store account or a renamed product
 * does not need a code change, but they default to the ids
 * the iOS app ships with. Today only the Companion tier is
 * sold on iOS (monthly + yearly); add rows here (and the
 * matching env vars) when a higher tier lands on iOS.
 */

const COMPANION_MONTHLY =
  process.env.APPLE_PRODUCT_COMPANION_MONTHLY ||
  "dev.kaisho.app.companion.monthly"

const COMPANION_YEARLY =
  process.env.APPLE_PRODUCT_COMPANION_YEARLY ||
  "dev.kaisho.app.companion.yearly"

const APPLE_PRODUCT_PLANS = {
  [COMPANION_MONTHLY]: "companion",
  [COMPANION_YEARLY]: "companion",
}

/**
 * Map an Apple product id to the plan it grants.
 *
 * @param {string} productId - StoreKit product identifier.
 * @returns {string|null} Plan name, or null if unknown.
 */
function planFromAppleProduct(productId) {
  return APPLE_PRODUCT_PLANS[productId] || null
}

module.exports = {
  APPLE_PRODUCT_PLANS,
  COMPANION_MONTHLY,
  COMPANION_YEARLY,
  planFromAppleProduct,
}
