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
const { apiLimiter } = require("../config")
const {
  validate, integrationConnectSchema,
} = require("../validation")
const { asyncHandler } = require("../utils/asyncHandler")
const {
  saveIntegration,
  listIntegrations,
  deleteIntegration,
} = require("../integrations/store")
const linear = require("../integrations/linear")

const router = Router()

// Registry of API-key / PAT connectable modules. OAuth
// providers register through the OAuth flow instead.
const KEY_MODULES = {
  [linear.KIND]: linear,
}

router.use(requireAuth)
router.use(apiLimiter)
// Premium integrations are a Pro feature.
router.use(requirePlan("pro", "team"))

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
