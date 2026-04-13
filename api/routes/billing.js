"use strict"

const { Router } = require("express")
const Stripe = require("stripe")
const { requireJwt } = require("../middleware")
const {
  BASE_URL, PLAN_PRICES, planFromPriceId,
} = require("../config")
const { supabase } = require("../db")
const { logger } = require("../logger")
const { validate, checkoutSchema } = require("../validation")
const {
  sendPlanUpgradeEmail,
  sendPlanCancelledEmail,
} = require("../emails/mailer")

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const router = Router()

// ── GET /billing/subscription ────────────────────────────

router.get(
  "/subscription",
  requireJwt,
  async (req, res) => {
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
  },
)

// ── POST /billing/checkout ───────────────────────────────

router.post(
  "/checkout",
  requireJwt,
  validate(checkoutSchema),
  async (req, res) => {
    try {
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
          }
        }
      }

      // Fresh Stripe checkout
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
    } catch (err) {
      logger.error({ err }, "Checkout error")
      res.status(500).json({
        error: "Checkout failed. Please try again.",
      })
    }
  },
)

// ── POST /billing/portal ─────────────────────────────────

router.post(
  "/portal",
  requireJwt,
  async (req, res) => {
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
  },
)

// ── Stripe webhook handler ───────────────────────────────

async function handleStripeEvent(event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object
      const { user_id, plan } = session.metadata || {}
      if (!user_id || !plan) break

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
      break
    }

    case "customer.subscription.updated": {
      const sub = event.data.object
      if (
        sub.status !== "active" &&
        sub.status !== "trialing"
      ) {
        break
      }

      const priceId = sub.items?.data?.[0]?.price?.id
      const newPlan = planFromPriceId(priceId)
      if (!newPlan) break

      if (sub.latest_invoice) {
        const invId =
          typeof sub.latest_invoice === "string"
            ? sub.latest_invoice
            : sub.latest_invoice.id
        const inv = await stripe.invoices.retrieve(invId)
        if (
          inv.amount_due > 0 &&
          inv.status !== "paid"
        ) {
          break
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
      break
    }

    case "invoice.paid": {
      const invoice = event.data.object
      if (!invoice.subscription) break

      const paidSub =
        await stripe.subscriptions.retrieve(
          invoice.subscription,
        )
      if (
        paidSub.status !== "active" &&
        paidSub.status !== "trialing"
      ) {
        break
      }

      const paidPriceId =
        paidSub.items?.data?.[0]?.price?.id
      const paidPlan = planFromPriceId(paidPriceId)
      if (!paidPlan) break

      await supabase
        .from("users")
        .update({ plan: paidPlan })
        .eq("stripe_customer_id", invoice.customer)

      logger.info(
        { invoice: invoice.id, plan: paidPlan },
        "Invoice paid",
      )
      break
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object

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
      break
    }

    case "customer.deleted": {
      await supabase
        .from("users")
        .update({
          stripe_customer_id: null,
          stripe_subscription_id: null,
          plan: "free",
        })
        .eq("stripe_customer_id", event.data.object.id)

      logger.info(
        { customer: event.data.object.id },
        "Customer deleted",
      )
      break
    }

    default:
      logger.debug(
        { type: event.type },
        "Unhandled Stripe event",
      )
  }
}

router.handleStripeEvent = handleStripeEvent

module.exports = router
