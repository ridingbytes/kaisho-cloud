"use strict"

/**
 * Billing routes — subscription management via Stripe.
 *
 * Handles checkout session creation, portal access, and
 * subscription status queries.
 */

const { Router } = require("express")
const Stripe = require("stripe")
const { requireJwt } = require("../middleware")
const {
  BASE_URL, PLAN_PRICES,
} = require("../config")
const { supabase } = require("../db")
const { logger } = require("../logger")
const { validate, checkoutSchema } = require("../validation")
const {
  sendPlanUpgradeEmail,
} = require("../emails/mailer")
const { asyncHandler } = require("../utils/asyncHandler")

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const router = Router()

// ── GET /billing/subscription ───────────────────────────

/**
 * Return the current plan and Stripe subscription
 * details for the authenticated user.
 *
 * @route GET /billing/subscription
 */
router.get(
  "/subscription",
  requireJwt,
  asyncHandler(async (req, res) => {
    const { data: user } = await supabase
      .from("users")
      .select("plan, stripe_subscription_id")
      .eq("id", req.userId)
      .single()

    if (!user?.stripe_subscription_id) {
      return res.json({
        plan: user?.plan || "free",
        subscription: null,
      })
    }

    let sub
    try {
      sub = await stripe.subscriptions.retrieve(
        user.stripe_subscription_id,
      )
    } catch (err) {
      if (err.code !== "resource_missing") throw err
      await supabase
        .from("users")
        .update({ stripe_subscription_id: null })
        .eq("id", req.userId)
      return res.json({
        plan: user.plan,
        subscription: null,
      })
    }

    res.json({
      plan: user.plan,
      subscription: {
        current_period_end: sub.current_period_end,
        cancel_at_period_end: sub.cancel_at_period_end,
        cancel_at: sub.cancel_at,
        status: sub.status,
      },
    })
  }),
)

// ── POST /billing/checkout ──────────────────────────────

/**
 * Create a Stripe checkout session or update an
 * existing subscription in place.
 *
 * @route POST /billing/checkout
 */
router.post(
  "/checkout",
  requireJwt,
  validate(checkoutSchema),
  asyncHandler(async (req, res) => {
    const { plan } = req.body
    const priceId = PLAN_PRICES[plan]

    if (!priceId) {
      return res
        .status(400)
        .json({ error: "Plan not available" })
    }

    const { data: user } = await supabase
      .from("users")
      .select(
        "id, plan, stripe_customer_id, " +
        "stripe_subscription_id",
      )
      .eq("id", req.userId)
      .single()

    if (!user) {
      return res
        .status(404)
        .json({ error: "User not found" })
    }

    // Try in-place subscription update
    if (user.stripe_subscription_id) {
      try {
        const sub = await stripe.subscriptions.retrieve(
          user.stripe_subscription_id,
        )
        const updatedSub =
          await stripe.subscriptions.update(
            user.stripe_subscription_id,
            {
              items: [{
                id: sub.items.data[0].id,
                price: priceId,
              }],
              proration_behavior: "always_invoice",
              payment_behavior: "error_if_incomplete",
              expand: ["latest_invoice"],
            },
          )
        const inv = updatedSub.latest_invoice

        if (
          inv && inv.amount_due > 0 &&
          inv.status !== "paid"
        ) {
          return res.json({
            url: inv.hosted_invoice_url,
          })
        }

        await supabase
          .from("users")
          .update({ plan })
          .eq("id", req.userId)

        sendPlanUpgradeEmail({
          email: req.userEmail,
          plan,
        })

        return res.json({ success: true, plan })
      } catch (err) {
        if (err.code === "resource_missing") {
          await supabase
            .from("users")
            .update({
              stripe_subscription_id: null,
              stripe_customer_id: null,
            })
            .eq("id", req.userId)
        } else {
          throw err
        }
      }
    }

    // Fresh Stripe checkout
    // Grant a 14-day trial on the first subscription.
    // Users who already have a Stripe customer ID have
    // subscribed before and don't get another trial.
    const isFirstSub = !user.stripe_customer_id
    const params = {
      mode: "subscription",
      customer: user.stripe_customer_id || undefined,
      customer_email: user.stripe_customer_id
        ? undefined
        : req.userEmail,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { user_id: req.userId, plan },
      success_url: `${BASE_URL}/m/?upgraded=true`,
      cancel_url: `${BASE_URL}/m/`,
      ...(isFirstSub && {
        subscription_data: {
          trial_period_days: 14,
        },
      }),
    }

    let session
    try {
      session =
        await stripe.checkout.sessions.create(params)
    } catch (err) {
      if (
        err.code !== "resource_missing" ||
        err.param !== "customer"
      ) {
        return res.status(400).json({
          error:
            err.message ||
            "Could not create checkout session",
        })
      }
      await supabase
        .from("users")
        .update({ stripe_customer_id: null })
        .eq("id", req.userId)
      params.customer = undefined
      params.customer_email = req.userEmail
      session =
        await stripe.checkout.sessions.create(params)
    }

    res.json({ url: session.url })
  }),
)

// ── POST /billing/portal ────────────────────────────────

/**
 * Create a Stripe billing portal session for the
 * authenticated user.
 *
 * @route POST /billing/portal
 */
router.post(
  "/portal",
  requireJwt,
  asyncHandler(async (req, res) => {
    const { data: user } = await supabase
      .from("users")
      .select("stripe_customer_id")
      .eq("id", req.userId)
      .single()

    if (!user?.stripe_customer_id) {
      return res.status(404).json({
        error: "No Stripe customer found",
      })
    }

    try {
      const session =
        await stripe.billingPortal.sessions.create({
          customer: user.stripe_customer_id,
          return_url: `${BASE_URL}/m/`,
        })
      res.json({ url: session.url })
    } catch (err) {
      if (err.code === "resource_missing") {
        await supabase
          .from("users")
          .update({ stripe_customer_id: null })
          .eq("id", req.userId)
        return res.status(404).json({
          error:
            "No active Stripe customer. " +
            "Please upgrade again.",
        })
      }
      logger.error({ err }, "Portal session error")
      res.status(400).json({
        error:
          err.message ||
          "Could not open billing portal",
      })
    }
  }),
)

module.exports = router
