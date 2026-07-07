"use strict"

/**
 * Apple App Store configuration.
 *
 * The iOS app is the only surface that uses these; the web
 * PWA stays Stripe-only. Values come from env so a different
 * App Store account or the Sandbox/Production split does not
 * need a code change.
 */

// The app's bundle id. Every StoreKit transaction carries
// it; we reject any transaction whose bundleId does not
// match, so a signed transaction minted for another app
// (even by Apple) can never grant a Kaisho plan.
const APPLE_BUNDLE_ID =
  process.env.APPLE_BUNDLE_ID || "dev.kaisho.app"

// Expected StoreKit environment. Production builds see
// "Production"; a Sandbox tester (and App Review) sees
// "Sandbox". Set APPLE_ENVIRONMENT to a comma-separated
// list to accept more than one (e.g. "Production,Sandbox"
// while App Review runs against the live build).
const APPLE_ENVIRONMENTS = (
  process.env.APPLE_ENVIRONMENT || "Production"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)

module.exports = {
  APPLE_BUNDLE_ID,
  APPLE_ENVIRONMENTS,
}
