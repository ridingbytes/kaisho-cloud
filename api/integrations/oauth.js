"use strict"

/**
 * @module integrations/oauth
 *
 * Generic OAuth 2.0 authorization-code flow for the
 * premium integrations that use it (Slack now, Google
 * Calendar next). Provider-specific bits live in the
 * PROVIDERS table; the route layer drives the flow.
 *
 * The callback is unauthenticated (the provider redirects
 * the browser back without our auth header), so the
 * caller's identity is carried in a signed, time-limited
 * ``state`` token (HMAC over INTEGRATION_KEY). Verifying
 * the signature on callback both authenticates the user
 * and provides CSRF protection.
 */

const crypto = require("crypto")
const { BASE_URL } = require("../config")

const STATE_TTL_MS = 10 * 60 * 1000

function stateSecret() {
  const k = process.env.INTEGRATION_KEY
  if (!k) throw new Error("INTEGRATION_KEY is not set")
  return k
}

/**
 * Sign a state payload (adds an expiry).
 *
 * @param {object} payload - e.g. { userId, kind }.
 * @returns {string} ``body.sig`` (base64url).
 */
function signState(payload) {
  const body = Buffer.from(
    JSON.stringify({
      ...payload, exp: Date.now() + STATE_TTL_MS,
    }),
  ).toString("base64url")
  const sig = crypto
    .createHmac("sha256", stateSecret())
    .update(body)
    .digest("base64url")
  return `${body}.${sig}`
}

/**
 * Verify a state token and return its payload. Throws on
 * a bad signature or expiry.
 *
 * @param {string} state
 * @returns {object} The original payload.
 */
function verifyState(state) {
  const [body, sig] = String(state).split(".")
  if (!body || !sig) throw new Error("Malformed state")
  const expected = crypto
    .createHmac("sha256", stateSecret())
    .update(body)
    .digest("base64url")
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("Bad state signature")
  }
  const payload = JSON.parse(
    Buffer.from(body, "base64url").toString("utf8"),
  )
  if (Date.now() > payload.exp) {
    throw new Error("State expired")
  }
  return payload
}

/**
 * The redirect URI registered with the provider for a
 * given integration kind.
 *
 * @param {string} kind
 * @returns {string}
 */
function redirectUri(kind) {
  return `${BASE_URL}/integrations/${kind}/callback`
}

// ── Providers ───────────────────────────────────────────

const PROVIDERS = {
  slack: {
    kind: "slack",
    scope: "channels:read,chat:write,search:read.public",
    clientId: () => process.env.SLACK_CLIENT_ID,
    clientSecret: () => process.env.SLACK_CLIENT_SECRET,

    buildAuthUrl(state) {
      const p = new URLSearchParams({
        client_id: this.clientId(),
        scope: this.scope,
        redirect_uri: redirectUri(this.kind),
        state,
      })
      return `https://slack.com/oauth/v2/authorize?${p}`
    },

    async exchange(code) {
      const res = await fetch(
        "https://slack.com/api/oauth.v2.access",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            client_id: this.clientId(),
            client_secret: this.clientSecret(),
            code,
            redirect_uri: redirectUri(this.kind),
          }),
        },
      )
      const json = await res.json()
      if (!json.ok) {
        throw new Error(
          `Slack OAuth: ${json.error || "unknown"}`,
        )
      }
      return {
        credentials: {
          access_token: json.access_token,
          team_id: json.team?.id,
        },
        scopes: (json.scope || "").split(","),
      }
    },
  },
}

/**
 * Look up an OAuth provider config by kind, or null.
 *
 * @param {string} kind
 * @returns {object|null}
 */
function getProvider(kind) {
  return PROVIDERS[kind] || null
}

/**
 * Whether a provider is configured (its client id/secret
 * env vars are present).
 *
 * @param {object} provider
 * @returns {boolean}
 */
function isConfigured(provider) {
  return !!(provider.clientId() && provider.clientSecret())
}

module.exports = {
  signState,
  verifyState,
  getProvider,
  isConfigured,
}
