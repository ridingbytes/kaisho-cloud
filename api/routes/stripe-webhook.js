"use strict"

/**
 * Stripe webhook event handling.
 *
 * Processes checkout completions, subscription changes,
 * invoice payments, cancellations, and customer deletions.
 */

const Stripe = require("stripe")
const { supabase } = require("../db")
const { logger } = require("../logger")
const {
  planFromPriceId,
  TOKEN_PACK_SIZE,
} = require("../config")
const { clearPlanCache } = require("../middleware")
const {
  sendPlanUpgradeEmail,
  sendPlanCancelledEmail,
} = require("../emails/mailer")

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

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

  await supabase
    .from("users")
    .update({
      plan,
      stripe_customer_id: session.customer,
      stripe_subscription_id: session.subscription,
    })
    .eq("id", user_id)

  clearPlanCache(user_id)

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
  if (!newPlan || newPlan === "token_pack") return

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

  const { data: subUser } = await supabase
    .from("users")
    .select("id")
    .eq("stripe_customer_id", sub.customer)
    .single()

  await supabase
    .from("users")
    .update({
      plan: newPlan,
      stripe_subscription_id: sub.id,
    })
    .eq("stripe_customer_id", sub.customer)

  if (subUser) clearPlanCache(subUser.id)

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

  const paidSub =
    await stripe.subscriptions.retrieve(
      invoice.subscription,
    )
  if (
    paidSub.status !== "active" &&
    paidSub.status !== "trialing"
  ) {
    return
  }

  const paidPriceId =
    paidSub.items?.data?.[0]?.price?.id
  const paidPlan = planFromPriceId(paidPriceId)
  if (!paidPlan || paidPlan === "token_pack") return

  const { data: invUser } = await supabase
    .from("users")
    .select("id")
    .eq("stripe_customer_id", invoice.customer)
    .single()

  await supabase
    .from("users")
    .update({ plan: paidPlan })
    .eq("stripe_customer_id", invoice.customer)

  if (invUser) clearPlanCache(invUser.id)

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
  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("stripe_customer_id", sub.customer)
    .single()

  await supabase
    .from("users")
    .update({
      plan: "free",
      stripe_subscription_id: null,
    })
    .eq("stripe_customer_id", sub.customer)

  if (user) {
    clearPlanCache(user.id)
    const { data: authData } =
      await supabase.auth.admin.getUserById(user.id)
    if (authData?.user?.email) {
      sendPlanCancelledEmail({
        email: authData.user.email,
      })
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
  const { data: delUser } = await supabase
    .from("users")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .single()

  await supabase
    .from("users")
    .update({
      stripe_customer_id: null,
      stripe_subscription_id: null,
      plan: "free",
    })
    .eq("stripe_customer_id", customerId)

  if (delUser) clearPlanCache(delUser.id)

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
  if (!priceId) return
  if (planFromPriceId(priceId) !== "token_pack") return

  const userId = await resolveUserFromPaymentIntent(pi)
  if (!userId) {
    logger.warn(
      { pi: pi.id, customer: pi.customer },
      "Token-pack PI without resolvable user",
    )
    return
  }

  const { error: insertErr } = await supabase
    .from("token_packs")
    .insert({
      user_id: userId,
      tokens: TOKEN_PACK_SIZE,
      stripe_charge_id: pi.id,
      stripe_price_id: priceId,
    })

  if (insertErr) {
    // 23505 = unique_violation → already processed.
    if (insertErr.code === "23505") {
      logger.debug(
        { pi: pi.id, user_id: userId },
        "Token-pack already credited, skipping",
      )
      return
    }
    throw insertErr
  }

  const { data: row } = await supabase
    .from("users")
    .select("bonus_tokens_remaining")
    .eq("id", userId)
    .single()

  const next =
    (row?.bonus_tokens_remaining || 0) + TOKEN_PACK_SIZE

  await supabase
    .from("users")
    .update({ bonus_tokens_remaining: next })
    .eq("id", userId)

  clearPlanCache(userId)

  logger.info(
    {
      pi: pi.id,
      user_id: userId,
      tokens: TOKEN_PACK_SIZE,
      bonus_total: next,
    },
    "Token pack credited",
  )
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
