"use strict"

/**
 * Kaisho Cloud — Sync API
 *
 * Entry point. Wires up middleware and route modules.
 */

const express = require("express")
const cors = require("cors")
const cookieParser = require("cookie-parser")
const { PORT, BASE_URL } = require("./config")
const { logger, httpLogger } = require("./logger")
const { supabase } = require("./db")

const authRoutes = require("./routes/auth")
const clockRoutes = require("./routes/clocks")
const syncRoutes = require("./routes/sync")
const billingRoutes = require("./routes/billing")

const app = express()

// ── Middleware ────────────────────────────────────────────

// Stripe webhook needs raw body for signature
// verification. Register before express.json().
app.use(
  "/billing/webhook/stripe",
  express.raw({ type: "application/json" }),
)

app.use(cors({ origin: BASE_URL, credentials: true }))
app.use(cookieParser())
app.use(express.json())
app.use(httpLogger)

// ── Routes ───────────────────────────────────────────────

app.use("/auth", authRoutes)
app.use("/clocks", clockRoutes)
app.use("/sync", syncRoutes)
app.use("/billing", billingRoutes)

// Reference data endpoints (mobile reads synced
// customers/tasks)
app.use("/ref", syncRoutes)

// ── Mobile SPA ───────────────────────────────────────────

const path = require("path")
const mobileDir = path.join(__dirname, "..", "mobile", "dist")
app.use("/m", express.static(mobileDir))
app.get("/m/*", (_req, res) => {
  res.sendFile(path.join(mobileDir, "index.html"))
})

// ── Health ───────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok" })
})

// ── Stripe webhook ───────────────────────────────────────

app.post(
  "/billing/webhook/stripe",
  async (req, res) => {
    const Stripe = require("stripe")
    const stripe = new Stripe(
      process.env.STRIPE_SECRET_KEY,
    )
    const sig = req.headers["stripe-signature"]
    let event

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET,
      )
    } catch (err) {
      logger.error(
        { err },
        "Webhook signature verification failed",
      )
      return res
        .status(400)
        .send(`Webhook Error: ${err.message}`)
    }

    const { data: existing } = await supabase
      .from("stripe_events")
      .select("id")
      .eq("id", event.id)
      .single()

    if (existing) {
      return res.json({
        received: true, duplicate: true,
      })
    }

    try {
      await billingRoutes.handleStripeEvent(event)
      await supabase.from("stripe_events").insert({
        id: event.id,
        type: event.type,
      })
      res.json({ received: true })
    } catch (err) {
      logger.error(
        { err, eventId: event.id },
        "Webhook processing error",
      )
      res
        .status(500)
        .json({ error: "Processing failed" })
    }
  },
)

// ── Start ────────────────────────────────────────────────

app.listen(PORT, () => {
  logger.info({ port: PORT }, "Kaisho Cloud API started")
})
