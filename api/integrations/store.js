"use strict"

/**
 * @module integrations/store
 *
 * Data-access layer for per-user integration credentials.
 * Wraps the ``user_integrations`` table and
 * transparently encrypts/decrypts the credential blob via
 * api/utils/crypto. Callers (the OAuth flow, the
 * integration modules) deal only in plaintext objects.
 */

const { db } = require("../db")
const { encryptJson, decryptJson } = require("../utils/crypto")

/**
 * Upsert a user's credentials for an integration.
 *
 * @param {string} userId
 * @param {string} kind - linear | github | google | slack
 * @param {object} credentials - Plaintext token/key object.
 * @param {object} [opts]
 * @param {string[]} [opts.scopes]
 * @param {string} [opts.expiresAt] - ISO timestamp.
 */
async function saveIntegration(
  userId, kind, credentials, opts = {},
) {
  const { error } = await db
    .from("user_integrations")
    .upsert({
      user_id: userId,
      kind,
      credentials: encryptJson(credentials),
      scopes: opts.scopes ?? null,
      expires_at: opts.expiresAt ?? null,
      updated_at: new Date().toISOString(),
    })
  if (error) throw error
}

/**
 * Fetch and decrypt a user's credentials for an
 * integration, or null if not connected.
 *
 * @param {string} userId
 * @param {string} kind
 * @returns {Promise<{
 *   credentials: object,
 *   scopes: string[] | null,
 *   expiresAt: string | null,
 * } | null>}
 */
async function getIntegration(userId, kind) {
  const { data } = await db
    .from("user_integrations")
    .select("credentials, scopes, expires_at")
    .eq("user_id", userId)
    .eq("kind", kind)
    .maybeSingle()
  if (!data) return null
  return {
    credentials: decryptJson(data.credentials),
    scopes: data.scopes,
    expiresAt: data.expires_at,
  }
}

/**
 * List a user's connected integrations. Never returns the
 * credential blob — only safe metadata for display.
 *
 * @param {string} userId
 * @returns {Promise<Array<{
 *   kind: string, scopes: string[] | null,
 *   expires_at: string | null, created_at: string,
 * }>>}
 */
async function listIntegrations(userId) {
  const { data } = await db
    .from("user_integrations")
    .select("kind, scopes, expires_at, created_at")
    .eq("user_id", userId)
  return data || []
}

/**
 * Disconnect (delete) a user's integration.
 *
 * @param {string} userId
 * @param {string} kind
 */
async function deleteIntegration(userId, kind) {
  await db
    .from("user_integrations")
    .delete()
    .eq("user_id", userId)
    .eq("kind", kind)
}

module.exports = {
  saveIntegration,
  getIntegration,
  listIntegrations,
  deleteIntegration,
}
