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
const { planFromPriceId } = require("../config")
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
  if (!newPlan) return

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

  await supabase
    .from("users")
    .update({
      plan: newPlan,
      stripe_subscription_id: sub.id,
    })
    .eq("stripe_customer_id", sub.customer)

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
  if (!paidPlan) return

  await supabase
    .from("users")
    .update({ plan: paidPlan })
    .eq("stripe_customer_id", invoice.customer)

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
  await supabase
    .from("users")
    .update({
      stripe_customer_id: null,
      stripe_subscription_id: null,
      plan: "free",
    })
    .eq("stripe_customer_id", customerId)

  logger.info(
    { customer: customerId },
    "Customer deleted",
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
    default:
      logger.debug(
        { type: event.type },
        "Unhandled Stripe event",
      )
  }
}

module.exports = { handleStripeEvent }
