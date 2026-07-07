"use strict"

/**
 * Verify Apple StoreKit 2 / App Store Server JWS payloads.
 *
 * Apple signs every transaction, renewal, and notification
 * as a JWS (compact form: header.payload.signature, ES256).
 * The header's x5c array carries the DER certificate chain
 * leaf → intermediate → Apple root. A payload is trustworthy
 * only if:
 *
 *   1. the x5c chain links leaf → … → a pinned Apple root,
 *   2. every cert in the chain is inside its validity window,
 *   3. the JWS signature verifies against the leaf's key.
 *
 * The trusted roots are injected (loadTrustedRoots() in
 * production, a locally-generated CA in tests) so the crypto
 * can be exercised without Apple's real certificate — and so
 * this module never has to fetch anything at runtime.
 *
 * No external dependencies: node:crypto's X509Certificate
 * does the chain math, and crypto.verify with the
 * ieee-p1363 dsaEncoding consumes the raw r‖s JWS signature.
 */

const fs = require("fs")
const path = require("path")
const crypto = require("crypto")

const { X509Certificate } = crypto

// Where production loads Apple's root CA(s) from. Operators
// drop AppleRootCA-G3.cer (DER) or a .pem here at deploy —
// see docs/apple-iap.md. Distinct from the Developer ID
// code-signing certs used to notarize the desktop app.
const DEFAULT_ROOT_DIR = path.join(__dirname, "certs")

/**
 * Base64url-decode a JWS segment into a Buffer.
 *
 * @param {string} segment
 * @returns {Buffer}
 */
function b64urlToBuffer(segment) {
  return Buffer.from(segment, "base64url")
}

/**
 * Split and JSON-decode a JWS without verifying it.
 *
 * Useful for reading the header (to get x5c) and, in tests,
 * for inspecting a payload. NEVER trust the payload this
 * returns without a prior verifyAppleJws() call.
 *
 * @param {string} jws - Compact JWS string.
 * @returns {{header: object, payload: object, parts: string[]}}
 */
function decodeJws(jws) {
  if (typeof jws !== "string") {
    throw new Error("JWS must be a string")
  }
  const parts = jws.split(".")
  if (parts.length !== 3) {
    throw new Error("Malformed JWS: expected 3 segments")
  }
  const header = JSON.parse(b64urlToBuffer(parts[0]).toString())
  const payload = JSON.parse(b64urlToBuffer(parts[1]).toString())
  return { header, payload, parts }
}

/**
 * Parse the x5c header entries into X509Certificate objects.
 * x5c entries are standard-base64 DER (not base64url).
 *
 * @param {string[]} x5c
 * @returns {import("crypto").X509Certificate[]}
 */
function parseX5c(x5c) {
  if (!Array.isArray(x5c) || x5c.length === 0) {
    throw new Error("JWS header missing x5c chain")
  }
  return x5c.map((b64) => new X509Certificate(Buffer.from(b64, "base64")))
}

/**
 * Is `now` within the certificate's validity window?
 *
 * @param {import("crypto").X509Certificate} cert
 * @param {number} now - Unix ms.
 * @returns {boolean}
 */
function isWithinValidity(cert, now) {
  const from = new Date(cert.validFrom).getTime()
  const to = new Date(cert.validTo).getTime()
  return now >= from && now <= to
}

/**
 * Find the trusted anchor for the top of an x5c chain.
 *
 * Apple includes the root itself as the last x5c entry, so
 * the common case is a raw match against a pinned root. We
 * also accept the case where the top entry is an intermediate
 * directly issued by a pinned root (root not inlined).
 *
 * @param {import("crypto").X509Certificate} top
 * @param {import("crypto").X509Certificate[]} trustedRoots
 * @returns {{root: object, topIsRoot: boolean}|null}
 */
function findAnchor(top, trustedRoots) {
  for (const root of trustedRoots) {
    if (root.raw.equals(top.raw)) {
      return { root, topIsRoot: true }
    }
  }
  for (const root of trustedRoots) {
    if (top.checkIssued(root) && top.verify(root.publicKey)) {
      return { root, topIsRoot: false }
    }
  }
  return null
}

/**
 * Verify the x5c chain links leaf → … → a trusted root and
 * that every certificate is currently valid.
 *
 * @param {import("crypto").X509Certificate[]} chain
 * @param {import("crypto").X509Certificate[]} trustedRoots
 * @param {number} now - Unix ms.
 * @throws if the chain is untrusted, broken, or expired.
 */
function verifyChain(chain, trustedRoots, now) {
  for (const cert of chain) {
    if (!isWithinValidity(cert, now)) {
      throw new Error("Certificate outside validity window")
    }
  }

  // Each cert must be issued by the next one up.
  for (let i = 0; i < chain.length - 1; i += 1) {
    const child = chain[i]
    const issuer = chain[i + 1]
    if (!child.checkIssued(issuer) || !child.verify(issuer.publicKey)) {
      throw new Error("Broken certificate chain")
    }
  }

  const top = chain[chain.length - 1]
  const anchor = findAnchor(top, trustedRoots)
  if (!anchor) {
    throw new Error("Chain does not terminate at a trusted Apple root")
  }
  // When the top entry is a self-signed root we already
  // confirmed it by raw equality; when it is an intermediate
  // findAnchor verified its signature against the pinned root.
}

/**
 * Verify the JWS signature against the leaf certificate.
 *
 * @param {string[]} parts - [headerB64, payloadB64, sigB64url].
 * @param {import("crypto").X509Certificate} leaf
 * @returns {boolean}
 */
function verifySignature(parts, leaf) {
  const signingInput = `${parts[0]}.${parts[1]}`
  const signature = b64urlToBuffer(parts[2])
  return crypto.verify(
    "sha256",
    Buffer.from(signingInput),
    { key: leaf.publicKey, dsaEncoding: "ieee-p1363" },
    signature,
  )
}

/**
 * Verify an Apple JWS end to end and return its payload.
 *
 * @param {string} jws - Compact JWS string.
 * @param {object} opts
 * @param {import("crypto").X509Certificate[]} opts.trustedRoots
 * @param {number} [opts.now] - Unix ms (injected for tests).
 * @returns {object} The verified payload.
 * @throws if any verification step fails.
 */
function verifyAppleJws(jws, { trustedRoots, now = Date.now() } = {}) {
  if (!Array.isArray(trustedRoots) || trustedRoots.length === 0) {
    throw new Error("No trusted Apple roots configured")
  }
  const { header, payload, parts } = decodeJws(jws)
  if (header.alg !== "ES256") {
    throw new Error(`Unsupported JWS alg: ${header.alg}`)
  }
  const chain = parseX5c(header.x5c)
  verifyChain(chain, trustedRoots, now)
  if (!verifySignature(parts, chain[0])) {
    throw new Error("JWS signature verification failed")
  }
  return payload
}

/**
 * Load pinned Apple root certificate(s) from disk.
 *
 * Reads every .cer / .crt / .pem / .der file in dir. DER and
 * PEM are both accepted (X509Certificate detects the form).
 * Throws when none are found so a misconfigured deploy fails
 * loud instead of trusting nothing (or, worse, everything).
 *
 * @param {string} [dir] - Directory of root certs.
 * @returns {import("crypto").X509Certificate[]}
 */
function loadTrustedRoots(
  dir = process.env.APPLE_ROOT_CA_PATH || DEFAULT_ROOT_DIR,
) {
  let files = []
  try {
    files = fs.readdirSync(dir)
  } catch {
    throw new Error(`Apple root CA directory not found: ${dir}`)
  }
  const roots = files
    .filter((f) => /\.(cer|crt|pem|der)$/i.test(f))
    .map((f) => new X509Certificate(fs.readFileSync(path.join(dir, f))))
  if (roots.length === 0) {
    throw new Error(`No Apple root certificates found in ${dir}`)
  }
  return roots
}

module.exports = {
  decodeJws,
  parseX5c,
  verifyChain,
  verifySignature,
  verifyAppleJws,
  loadTrustedRoots,
  DEFAULT_ROOT_DIR,
}
