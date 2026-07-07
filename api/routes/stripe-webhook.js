"use strict"

/**
 * Stripe webhook event handling.
 *
 * Processes checkout completions, subscription changes,
 * invoice payments, cancellations, and customer deletions.
 */

const { supabase } = require("../db")
const { logger } = require("../logger")
const {
  planFromPriceId,
  TOKEN_PACK_PLAN,
  TOKEN_PACK_SIZE,
} = require("../config")
const { reconcilePlan } = require("../billing/reconcile")
const { stripe } = require("../stripe")
const {
  sendPlanUpgradeEmail,
  sendPlanCancelledEmail,
  sendTokenPackPurchasedEmail,
} = require("../emails/mailer")

/**
 * Look up the internal user id by Stripe customer id.
 *
 * Extracted helper — four event handlers in this file
 * (subscription updated/deleted, invoice paid, customer
 * deleted) all need to clear the plan cache and need the
 * users.id to do it.
 *
 * @param {string} customerId - Stripe customer id.
 * @returns {Promise<string|null>} User id or null.
 */
async function findUserIdByCustomer(customerId) {
  const { data } = await supabase
    .from("users")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .single()
  return data?.id || null
}

/**
 * Handle a checkout.session.completed event.
 *
 * Links the Stripe customer and subscription to the
 * internal user record and sends an upgrade email.
 *
 * @param {object} session - Stripe session object.
 */
async function onCheckoutCompleted(session) {
  const { user_id, plan } = session.metadata || {}
  if (!user_id || !plan) return

  // Record Stripe's grant on its own source column; the
  // reconciler recomputes users.plan (and clears the cache)
  // so an Apple grant is never clobbered. See plans.js.
  await supabase
    .from("users")
    .update({
      stripe_plan: plan,
      stripe_customer_id: session.customer,
      stripe_subscription_id: session.subscription,
    })
    .eq("id", user_id)

  await reconcilePlan(user_id)

  const { data: authData } =
    await supabase.auth.admin.getUserById(user_id)

  if (authData?.user?.email) {
    sendPlanUpgradeEmail({
      email: authData.user.email,
      plan,
    })
  }

  logger.info(
    { user_id, plan },
    "Checkout completed",
  )
}

/**
 * Handle a customer.subscription.updated event.
 *
 * Updates the user plan when the subscription price
 * changes and the latest invoice is paid.
 *
 * @param {object} sub - Stripe subscription object.
 */
async function onSubscriptionUpdated(sub) {
  if (
    sub.status !== "active" &&
    sub.status !== "trialing"
  ) {
    return
  }

  const priceId = sub.items?.data?.[0]?.price?.id
  const newPlan = planFromPriceId(priceId)
  // token_pack is a one-off price; it should never
  // appear on a subscription, but guard anyway.
  if (!newPlan || newPlan === TOKEN_PACK_PLAN) return

  if (sub.latest_invoice) {
    const invId =
      typeof sub.latest_invoice === "string"
        ? sub.latest_invoice
        : sub.latest_invoice.id
    const inv = await stripe.invoices.retrieve(invId)
    if (inv.amount_due > 0 && inv.status !== "paid") {
      return
    }
  }

  const userId = await findUserIdByCustomer(sub.customer)

  await supabase
    .from("users")
    .update({
      stripe_plan: newPlan,
      stripe_subscription_id: sub.id,
    })
    .eq("stripe_customer_id", sub.customer)

  if (userId) await reconcilePlan(userId)

  logger.info(
    { customer: sub.customer, plan: newPlan },
    "Subscription updated",
  )
}

/**
 * Handle an invoice.paid event.
 *
 * Ensures the user plan matches the subscription price
 * after a successful payment.
 *
 * @param {object} invoice - Stripe invoice object.
 */
async function onInvoicePaid(invoice) {
  if (!invoice.subscription) return

  // Pull price and status directly from the invoice — the
  // subscriptions.retrieve round-trip the previous version
  // did was a network hop for data Stripe already includes
  // in the event payload. We're inside invoice.paid so
  // invoice.status is "paid" by definition; guard anyway
  // for defence-in-depth against unexpected event shapes.
  if (invoice.status !== "paid") return

  const paidPriceId =
    invoice.lines?.data?.[0]?.price?.id
  const paidPlan = planFromPriceId(paidPriceId)
  if (!paidPlan || paidPlan === TOKEN_PACK_PLAN) return

  const userId =
    await findUserIdByCustomer(invoice.customer)

  await supabase
    .from("users")
    .update({ stripe_plan: paidPlan })
    .eq("stripe_customer_id", invoice.customer)

  if (userId) await reconcilePlan(userId)

  logger.info(
    { invoice: invoice.id, plan: paidPlan },
    "Invoice paid",
  )
}

/**
 * Handle a customer.subscription.deleted event.
 *
 * Downgrades the user to the free plan and sends a
 * cancellation email.
 *
 * @param {object} sub - Stripe subscription object.
 */
async function onSubscriptionDeleted(sub) {
  const userId = await findUserIdByCustomer(sub.customer)

  // Clear Stripe's grant and reconcile. If the user still
  // has an active Apple subscription the effective plan
  // stays paid — so only send the "cancelled" email when
  // reconciliation actually drops them to free.
  await supabase
    .from("users")
    .update({
      stripe_plan: null,
      stripe_subscription_id: null,
    })
    .eq("stripe_customer_id", sub.customer)

  if (userId) {
    const effective = await reconcilePlan(userId)
    if (effective === "free") {
      const { data: authData } =
        await supabase.auth.admin.getUserById(userId)
      if (authData?.user?.email) {
        sendPlanCancelledEmail({
          email: authData.user.email,
        })
      }
    }
  }

  logger.info(
    { customer: sub.customer },
    "Subscription cancelled",
  )
}

/**
 * Handle a customer.deleted event.
 *
 * Clears all Stripe references and downgrades the user.
 *
 * @param {string} customerId - Stripe customer ID.
 */
async function onCustomerDeleted(customerId) {
  const userId = await findUserIdByCustomer(customerId)

  await supabase
    .from("users")
    .update({
      stripe_customer_id: null,
      stripe_subscription_id: null,
      stripe_plan: null,
    })
    .eq("stripe_customer_id", customerId)

  if (userId) await reconcilePlan(userId)

  logger.info(
    { customer: customerId },
    "Customer deleted",
  )
}

/**
 * Resolve the internal user id for a PaymentIntent.
 *
 * Prefers ``pi.metadata.user_id`` (set at checkout via
 * ``payment_intent_data.metadata``) and falls back to
 * looking the user up by ``stripe_customer_id``.
 *
 * @param {object} pi - Stripe PaymentIntent.
 * @returns {Promise<string|null>} User id or null.
 */
async function resolveUserFromPaymentIntent(pi) {
  if (pi.metadata?.user_id) return pi.metadata.user_id
  if (!pi.customer) return null
  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("stripe_customer_id", pi.customer)
    .single()
  return user?.id || null
}

/**
 * Handle a payment_intent.succeeded event.
 *
 * Token-pack purchases are one-off charges (Stripe
 * ``mode: "payment"``). On success, insert a row into
 * ``token_packs`` and bump ``users.bonus_tokens_remaining``
 * by ``TOKEN_PACK_SIZE``. Idempotency is enforced by the
 * ``stripe_charge_id UNIQUE`` constraint — a duplicate
 * delivery hits the constraint and the bump is skipped.
 *
 * Non-token-pack PaymentIntents (e.g. subscription
 * invoices) are ignored: those are settled through
 * ``invoice.paid`` and ``customer.subscription.updated``.
 *
 * @param {object} pi - Stripe PaymentIntent.
 */
async function onPaymentIntentSucceeded(pi) {
  const priceId = pi.metadata?.price_id
  if (!priceId) {
    // A PaymentIntent reaching this handler without a
    // price_id is almost always a manual charge from the
    // Stripe dashboard (where nobody sets the metadata).
    // Log it so an operator can decide whether to back-fill
    // tokens for that user by hand.
    logger.warn(
      { pi: pi.id, customer: pi.customer },
      "PaymentIntent without price_id metadata, skipping",
    )
    return
  }
  if (planFromPriceId(priceId) !== TOKEN_PACK_PLAN) return

  const userId = await resolveUserFromPaymentIntent(pi)
  if (!userId) {
    logger.warn(
      { pi: pi.id, customer: pi.customer },
      "Token-pack PI without resolvable user",
    )
    return
  }

  // Atomic ledger-insert + balance-bump (migration 016).
  // Doing both in one RPC closes two races the prior
  // insert-then-update had: concurrent purchases clobbering
  // the balance, and a redelivery skipping the bump after
  // a partial write. Returns the new balance, or null when
  // this charge was already credited (idempotent).
  const { data: next, error: creditErr } =
    await supabase.rpc("credit_token_pack", {
      p_user_id: userId,
      p_charge_id: pi.id,
      p_price_id: priceId,
      p_tokens: TOKEN_PACK_SIZE,
    })
  if (creditErr) {
    logger.error(
      { err: creditErr, pi: pi.id, user_id: userId },
      "Token-pack credit failed",
    )
    throw creditErr
  }
  if (next == null) {
    logger.debug(
      { pi: pi.id, user_id: userId },
      "Token-pack already credited, skipping",
    )
    return
  }

  // No cache to clear: bonus_tokens_remaining is read
  // fresh from users by resolveCap() on every AI request.
  // clearPlanCache() only touches PLAN_CACHE and the auth
  // cache, neither of which stores bonus tokens.

  logger.info(
    {
      pi: pi.id,
      user_id: userId,
      tokens: TOKEN_PACK_SIZE,
      bonus_total: next,
    },
    "Token pack credited",
  )

  const { data: authData } =
    await supabase.auth.admin.getUserById(userId)
  if (authData?.user?.email) {
    sendTokenPackPurchasedEmail({
      email: authData.user.email,
      tokens: TOKEN_PACK_SIZE,
      bonusTotal: next,
    })
  }
}

/**
 * Dispatch a verified Stripe event to the appropriate
 * handler.
 *
 * @param {object} event - Verified Stripe event.
 */
async function handleStripeEvent(event) {
  switch (event.type) {
    case "checkout.session.completed":
      await onCheckoutCompleted(event.data.object)
      break
    case "customer.subscription.updated":
      await onSubscriptionUpdated(event.data.object)
      break
    case "invoice.paid":
      await onInvoicePaid(event.data.object)
      break
    case "customer.subscription.deleted":
      await onSubscriptionDeleted(event.data.object)
      break
    case "customer.deleted":
      await onCustomerDeleted(event.data.object.id)
      break
    case "payment_intent.succeeded":
      await onPaymentIntentSucceeded(event.data.object)
      break
    default:
      logger.debug(
        { type: event.type },
        "Unhandled Stripe event",
      )
  }
}

module.exports = { handleStripeEvent, stripe }
