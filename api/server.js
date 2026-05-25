"use strict"

/**
 * Kaisho Cloud — Sync API
 *
 * Entry point. Wires up middleware, route modules, and
 * error handling.
 */

const path = require("path")
const http = require("http")
const express = require("express")
const helmet = require("helmet")
const cors = require("cors")
const cookieParser = require("cookie-parser")
const { PORT, BASE_URL } = require("./config")
const { logger, httpLogger } = require("./logger")
const { supabase } = require("./db")
const { asyncHandler } = require("./utils/asyncHandler")
const {
  handleStripeEvent, stripe,
} = require("./routes/stripe-webhook")

const authRoutes = require("./routes/auth")
const clockRoutes = require("./routes/clocks")
const syncRoutes = require("./routes/sync")
const refRoutes = require("./routes/ref")
const billingRoutes = require("./routes/billing")
const aiRoutes = require("./routes/ai")
const cloudJobRoutes = require("./routes/cloud-jobs")
const integrationRoutes = require("./routes/integrations")

const app = express()

// ── Middleware ───────────────────────────────────────────

// Stripe webhook needs raw body for signature
// verification. Register before express.json().
app.use(
  "/billing/webhook/stripe",
  express.raw({ type: "application/json" }),
)

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", BASE_URL, "wss:"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
}))
app.use(cors({ origin: BASE_URL, credentials: true }))
app.use(cookieParser())
app.use(express.json({ limit: "1mb" }))
app.use(httpLogger)

// ── Routes ──────────────────────────────────────────────

app.use("/auth", authRoutes)
app.use("/clocks", clockRoutes)
app.use("/sync", syncRoutes)
app.use("/ref", refRoutes)
app.use("/billing", billingRoutes)
app.use("/ai", aiRoutes)
app.use("/cloud", cloudJobRoutes)
app.use("/integrations", integrationRoutes)

// Hosted MCP gateway (Companion+) — opt-in. Disabled by
// default so deployments without the feature flag set
// don't expose the endpoint at all (not even 401-ing).
if (process.env.MCP_GATEWAY_ENABLED === "true") {
  app.use("/mcp", require("./routes/mcp"))
  logger.info("MCP gateway enabled at /mcp")
}

// ── Mobile SPA ──────────────────────────────────────────

const mobileDir = path.join(
  __dirname, "..", "mobile", "dist",
)
// Service worker must not be cached by the browser
// so updates propagate immediately.
app.get("/m/sw.js", (_req, res) => {
  res.setHeader(
    "Cache-Control",
    "no-cache, no-store, must-revalidate",
  )
  res.sendFile(path.join(mobileDir, "sw.js"))
})
app.use("/m", express.static(mobileDir))
app.get("/m/*", (_req, res) => {
  res.sendFile(path.join(mobileDir, "index.html"))
})

// ── Health ──────────────────────────────────────────────

/** @route GET / */
app.get("/", (_req, res) => {
  res.json({
    service: "kaisho-cloud",
    status: "ok",
    mobile: "/m/",
    docs: "https://kaisho.dev",
  })
})

/** @route GET /health */
app.get("/health", (_req, res) => {
  res.json({ status: "ok" })
})

// ── Stripe webhook ──────────────────────────────────────

/**
 * Receive and process Stripe webhook events.
 *
 * @route POST /billing/webhook/stripe
 */
app.post(
  "/billing/webhook/stripe",
  asyncHandler(async (req, res) => {
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
        .json({ error: `Webhook Error: ${err.message}` })
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

    await handleStripeEvent(event)
    await supabase.from("stripe_events").insert({
      id: event.id,
      type: event.type,
    })
    res.json({ received: true })
  }),
)

// ── Error handler ───────────────────────────────────────

/**
 * Global Express error handler. Catches unhandled errors
 * from asyncHandler and other middleware.
 */
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  logger.error({ err }, "Unhandled route error")
  res.status(500).json({ error: "Internal server error" })
})

// ── Start ───────────────────────────────────────────────

const { setupWebSocket } = require("./ws")

const server = http.createServer(app)
setupWebSocket(server)

server.listen(PORT, () => {
  logger.info(
    { port: PORT },
    "Kaisho Cloud API started (WS enabled)",
  )
})
