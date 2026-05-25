"use strict"

/**
 * @module utils/crypto
 *
 * AES-256-GCM helpers for encrypting third-party
 * integration credentials at rest (Pro tier). The key
 * lives only in the INTEGRATION_KEY env var (32 bytes,
 * hex) — never in the database — so a DB dump alone can't
 * recover any stored OAuth tokens / API keys.
 *
 * Blob format: ``<iv>.<tag>.<ciphertext>`` with each part
 * base64-encoded. GCM authenticates the ciphertext, so
 * tampering is detected on decrypt.
 */

const crypto = require("crypto")

const ALGO = "aes-256-gcm"
const IV_BYTES = 12

/**
 * Resolve and validate the 32-byte AES key from
 * INTEGRATION_KEY. Throws if missing or malformed —
 * called lazily so the API boots even when integrations
 * are not configured.
 *
 * @returns {Buffer} 32-byte key.
 */
function getKey() {
  const hex = process.env.INTEGRATION_KEY
  if (!hex) {
    throw new Error("INTEGRATION_KEY is not set")
  }
  const key = Buffer.from(hex, "hex")
  if (key.length !== 32) {
    throw new Error(
      "INTEGRATION_KEY must be 32 bytes (64 hex chars)",
    )
  }
  return key
}

/**
 * Encrypt a JSON-serialisable value to a compact string.
 *
 * @param {*} value - Any JSON-serialisable value.
 * @returns {string} ``iv.tag.ciphertext`` (base64 parts).
 */
function encryptJson(value) {
  const key = getKey()
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const plaintext = Buffer.from(
    JSON.stringify(value), "utf8",
  )
  const ct = Buffer.concat([
    cipher.update(plaintext), cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return [
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(".")
}

/**
 * Decrypt a blob produced by {@link encryptJson}.
 *
 * @param {string} blob - ``iv.tag.ciphertext``.
 * @returns {*} The original value.
 */
function decryptJson(blob) {
  const key = getKey()
  const [ivB64, tagB64, ctB64] = String(blob).split(".")
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error("Malformed encrypted blob")
  }
  const decipher = crypto.createDecipheriv(
    ALGO, key, Buffer.from(ivB64, "base64"),
  )
  decipher.setAuthTag(Buffer.from(tagB64, "base64"))
  const pt = Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ])
  return JSON.parse(pt.toString("utf8"))
}

module.exports = { encryptJson, decryptJson }
