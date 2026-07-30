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

const authRoutes = require("./routes/auth")
const clockRoutes = require("./routes/clocks")
const syncRoutes = require("./routes/sync")
const refRoutes = require("./routes/ref")
const aiRoutes = require("./routes/ai")
const cloudJobRoutes = require("./routes/cloud-jobs")
const integrationRoutes = require("./routes/integrations")
const adminRoutes = require("./routes/admin")

const app = express()

// Trust the single immediate proxy (Traefik) so req.ip,
// req.protocol, and rate-limiter keys reflect the real
// client IP from X-Forwarded-For instead of the proxy's
// loopback address. Keep this tight (1, not true) so a
// client-supplied X-Forwarded-For chain can't spoof its
// IP past Traefik.
app.set("trust proxy", 1)

// ── Middleware ───────────────────────────────────────────

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
app.use("/ai", aiRoutes)
app.use("/cloud", cloudJobRoutes)
app.use("/integrations", integrationRoutes)
app.use("/admin", adminRoutes)

// Hosted MCP gateway (Companion+) — opt-in. Disabled by
// default so deployments without the feature flag set
// don't expose the endpoint at all (not even 401-ing).
if (process.env.MCP_GATEWAY_ENABLED === "true") {
  app.use("/mcp", require("./routes/mcp"))
  logger.info("MCP gateway enabled at /mcp")
} else {
  // Surface the disabled state on startup so an operator
  // tracing a 404 on /mcp sees the flag is off instead
  // of chasing a routing bug.
  logger.info(
    "MCP gateway disabled (MCP_GATEWAY_ENABLED != \"true\")",
  )
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
