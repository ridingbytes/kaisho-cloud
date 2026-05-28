"use strict"

/**
 * @module routes/integrations
 *
 * Manage a user's premium integrations (Pro tier):
 * connect (store credentials), list connected, disconnect.
 * The integration tools themselves are exposed through the
 * MCP gateway, not here.
 *
 * API-key / PAT providers (Linear, GitHub) connect by
 * POSTing their token. OAuth providers (Google, Slack)
 * connect through the OAuth flow and are not handled here.
 */

const { Router } = require("express")
const { requireAuth, requirePlan } = require("../middleware")
const { apiLimiter, oauthCallbackLimiter } = require(
  "../config",
)
const {
  validate,
  integrationConnectSchema,
  integrationDispatchSchema,
} = require("../validation")
const { runIntegrationTool } = require("../integrations")
const { asyncHandler } = require("../utils/asyncHandler")
const {
  saveIntegration,
  listIntegrations,
  deleteIntegration,
} = require("../integrations/store")
const {
  signState, verifyState, getProvider, isConfigured,
} = require("../integrations/oauth")
const { logger } = require("../logger")
const { BASE_URL } = require("../config")
const linear = require("../integrations/linear")
const github = require("../integrations/github")

const router = Router()

// Registry of API-key / PAT connectable modules. OAuth
// providers register through the OAuth flow instead.
const KEY_MODULES = {
  [linear.KIND]: linear,
  [github.KIND]: github,
}

// ── OAuth callback (UNAUTHENTICATED) ────────────────────
//
// The provider redirects the browser here without our auth
// header; identity comes from the signed state. Defined
// before the auth middleware so it isn't gated.

/**
 * @route GET /integrations/:kind/callback?code&state
 */
router.get(
  "/:kind/callback",
  oauthCallbackLimiter,
  asyncHandler(async (req, res) => {
    const provider = getProvider(req.params.kind)
    if (!provider) return res.status(404).send("Unknown")

    const done = (status) =>
      res.redirect(
        `${BASE_URL}/m/?integration=${provider.kind}`
        + `&status=${status}`,
      )

    let payload
    try {
      payload = verifyState(req.query.state)
    } catch {
      return done("error")
    }
    if (payload.kind !== provider.kind || req.query.error) {
      return done("error")
    }

    try {
      const { credentials, scopes, expiresAt } =
        await provider.exchange(req.query.code)
      await saveIntegration(
        payload.userId, provider.kind, credentials,
        { scopes, expiresAt },
      )
      return done("connected")
    } catch (err) {
      logger.error(
        { err, kind: provider.kind },
        "OAuth callback failed",
      )
      return done("error")
    }
  }),
)

router.use(requireAuth)
router.use(apiLimiter)
// Premium integrations are a Pro feature.
router.use(requirePlan("pro", "team"))

// ── GET /integrations/:kind/connect ─────────────────────

/**
 * Start an OAuth connect: returns the provider authorize
 * URL (with a signed state) for the client to open.
 *
 * @route GET /integrations/:kind/connect
 */
router.get(
  "/:kind/connect",
  asyncHandler(async (req, res) => {
    const provider = getProvider(req.params.kind)
    if (!provider) {
      return res
        .status(404)
        .json({ error: "Not an OAuth integration" })
    }
    if (!isConfigured(provider)) {
      return res.status(503).json({
        error: `${provider.kind} OAuth is not configured`,
      })
    }
    const state = signState({
      userId: req.userId, kind: provider.kind,
    })
    res.json({ url: provider.buildAuthUrl(state) })
  }),
)

// ── GET /integrations ───────────────────────────────────

/**
 * List the user's connected integrations (metadata only,
 * never the stored credentials).
 *
 * @route GET /integrations
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await listIntegrations(req.userId))
  }),
)

// ── POST /integrations/dispatch ─────────────────────────
//
// Defined before /:kind so "dispatch" isn't captured as a
// :kind. Runs one integration tool for the user — used by
// the desktop Advisor to call calendar/slack/linear/github
// tools (whose credentials + dispatch live server-side).

/**
 * @route POST /integrations/dispatch  { kind, tool, args }
 */
router.post(
  "/dispatch",
  validate(integrationDispatchSchema),
  asyncHandler(async (req, res) => {
    const { kind, tool, args } = req.body
    try {
      const result = await runIntegrationTool(
        req.userId, kind, tool, args || {},
      )
      res.json({ result })
    } catch (err) {
      res.status(400).json({ error: err.message })
    }
  }),
)

// ── POST /integrations/:kind ────────────────────────────

/**
 * Connect an API-key / PAT based integration. Validates
 * the credential against the provider before storing it.
 *
 * @route POST /integrations/:kind
 */
router.post(
  "/:kind",
  validate(integrationConnectSchema),
  asyncHandler(async (req, res) => {
    const mod = KEY_MODULES[req.params.kind]
    if (!mod) {
      return res.status(404).json({
        error: "Unknown or non-key integration",
      })
    }

    let account
    try {
      account = await mod.validate(req.body)
    } catch (err) {
      return res.status(400).json({
        error:
          `Could not verify ${req.params.kind} credentials`,
        detail: err.message,
      })
    }

    await saveIntegration(req.userId, mod.KIND, req.body)
    res.json({ connected: mod.KIND, account })
  }),
)

// ── DELETE /integrations/:kind ──────────────────────────

/**
 * Disconnect an integration (deletes stored credentials).
 *
 * @route DELETE /integrations/:kind
 */
router.delete(
  "/:kind",
  asyncHandler(async (req, res) => {
    await deleteIntegration(req.userId, req.params.kind)
    res.json({ disconnected: req.params.kind })
  }),
)

module.exports = router
