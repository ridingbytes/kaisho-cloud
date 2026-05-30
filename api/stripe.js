"use strict"

/**
 * Shared Stripe client.
 *
 * Both `routes/billing.js` (checkout / portal session
 * creation) and `routes/stripe-webhook.js` (subscription
 * + payment event handlers) need a Stripe SDK instance.
 * Importing one instance here keeps the SDK version,
 * API version pinning, and any future telemetry / retry
 * config in a single place.
 */

const Stripe = require("stripe")
const { supabase } = require("./db")

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

/**
 * Create a Stripe Checkout session, with one retry if the
 * user's stored `stripe_customer_id` no longer exists.
 *
 * Both `/billing/checkout` (subscription) and
 * `/billing/token-pack` (one-off) need this — when a
 * customer is deleted in the Stripe dashboard our DB row
 * still points at the missing id, and Stripe answers
 * `resource_missing` on `customer`. Clear the stale id,
 * fall back to `customer_email`, and try again.
 *
 * On any other error the original error is rethrown so the
 * caller can map it to a 400 response with its own message.
 *
 * @param {object} params - Stripe checkout session params.
 *   Mutated in place on retry (customer cleared,
 *   customer_email set).
 * @param {string} userId - Internal user id (for the
 *   stale-customer UPDATE).
 * @param {string} userEmail - Email to fall back to on
 *   retry.
 * @returns {Promise<object>} The created session.
 */
async function createCheckoutSessionWithCustomerRetry(
  params, userId, userEmail,
) {
  try {
    return await stripe.checkout.sessions.create(params)
  } catch (err) {
    if (
      err.code !== "resource_missing" ||
      err.param !== "customer"
    ) {
      throw err
    }
    await supabase
      .from("users")
      .update({ stripe_customer_id: null })
      .eq("id", userId)
    params.customer = undefined
    params.customer_email = userEmail
    return await stripe.checkout.sessions.create(params)
  }
}

module.exports = {
  stripe,
  createCheckoutSessionWithCustomerRetry,
}
