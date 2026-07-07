"use strict"

/**
 * Test helper: mint a real ES256 certificate chain
 * (root → intermediate → leaf) with openssl, and sign
 * StoreKit-style JWS payloads with the leaf key.
 *
 * This lets the JWS verification path be exercised end to
 * end without Apple's real certificate: tests generate their
 * own trust anchor and pass it in as trustedRoots. openssl
 * is required at test time only (macOS/Linux ship it); the
 * generated material lives in a temp dir, nothing is
 * committed.
 */

const fs = require("fs")
const os = require("os")
const path = require("path")
const crypto = require("crypto")
const { execFileSync } = require("child_process")

const { X509Certificate } = crypto

/**
 * Run openssl with args in a working directory.
 * @param {string[]} args
 * @param {string} cwd
 */
function openssl(args, cwd) {
  execFileSync("openssl", args, { cwd, stdio: "pipe" })
}

/**
 * Generate a P-256 EC private key file.
 * @param {string} dir
 * @param {string} name
 */
function genKey(dir, name) {
  openssl(
    ["ecparam", "-name", "prime256v1", "-genkey",
      "-noout", "-out", name],
    dir,
  )
}

/**
 * Write a minimal extfile enabling (or not) the CA bit.
 * @param {string} dir
 * @param {string} name
 * @param {boolean} isCa
 */
function writeExt(dir, name, isCa) {
  const ca = isCa ? "TRUE" : "FALSE"
  fs.writeFileSync(
    path.join(dir, name),
    `basicConstraints=critical,CA:${ca}\n`,
  )
}

/**
 * Build a fresh root/intermediate/leaf chain.
 *
 * @returns {{
 *   dir: string,
 *   rootCert: import("crypto").X509Certificate,
 *   leafCert: import("crypto").X509Certificate,
 *   leafPrivateKey: import("crypto").KeyObject,
 *   x5c: string[],
 * }}
 */
function buildChain() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apple-certs-"))

  // Root (self-signed CA). req -x509 takes -addext, not
  // -extfile (that is an x509 -req flag).
  genKey(dir, "root.key")
  openssl(
    ["req", "-x509", "-new", "-key", "root.key", "-days", "3650",
      "-subj", "/CN=Test Apple Root",
      "-addext", "basicConstraints=critical,CA:TRUE",
      "-out", "root.crt"],
    dir,
  )

  // Intermediate (signed by root, CA:TRUE)
  genKey(dir, "int.key")
  openssl(
    ["req", "-new", "-key", "int.key",
      "-subj", "/CN=Test Apple Intermediate", "-out", "int.csr"],
    dir,
  )
  writeExt(dir, "int.ext", true)
  openssl(
    ["x509", "-req", "-in", "int.csr", "-CA", "root.crt",
      "-CAkey", "root.key", "-CAcreateserial", "-days", "3650",
      "-extfile", "int.ext", "-out", "int.crt"],
    dir,
  )

  // Leaf (signed by intermediate, CA:FALSE)
  genKey(dir, "leaf.key")
  openssl(
    ["req", "-new", "-key", "leaf.key",
      "-subj", "/CN=Test Apple Leaf", "-out", "leaf.csr"],
    dir,
  )
  writeExt(dir, "leaf.ext", false)
  openssl(
    ["x509", "-req", "-in", "leaf.csr", "-CA", "int.crt",
      "-CAkey", "int.key", "-CAcreateserial", "-days", "3650",
      "-extfile", "leaf.ext", "-out", "leaf.crt"],
    dir,
  )

  const read = (f) =>
    new X509Certificate(fs.readFileSync(path.join(dir, f)))
  const rootCert = read("root.crt")
  const intCert = read("int.crt")
  const leafCert = read("leaf.crt")
  const leafPrivateKey = crypto.createPrivateKey(
    fs.readFileSync(path.join(dir, "leaf.key")),
  )

  // x5c is standard-base64 DER, leaf first.
  const x5c = [leafCert, intCert, rootCert].map((c) =>
    Buffer.from(c.raw).toString("base64"),
  )

  return { dir, rootCert, leafCert, leafPrivateKey, x5c }
}

/**
 * base64url without padding.
 * @param {Buffer|string} input
 * @returns {string}
 */
function b64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input)
  return buf.toString("base64url")
}

/**
 * Sign a payload as a StoreKit-style ES256 JWS.
 *
 * @param {object} payload
 * @param {object} chain - From buildChain().
 * @returns {string} Compact JWS.
 */
function signJws(payload, chain) {
  const header = { alg: "ES256", x5c: chain.x5c }
  const headerB64 = b64url(JSON.stringify(header))
  const payloadB64 = b64url(JSON.stringify(payload))
  const signingInput = `${headerB64}.${payloadB64}`
  const signature = crypto.sign(
    "sha256",
    Buffer.from(signingInput),
    { key: chain.leafPrivateKey, dsaEncoding: "ieee-p1363" },
  )
  return `${signingInput}.${b64url(signature)}`
}

/**
 * Remove a chain's temp directory.
 * @param {object} chain
 */
function cleanup(chain) {
  fs.rmSync(chain.dir, { recursive: true, force: true })
}

module.exports = { buildChain, signJws, b64url, cleanup }
