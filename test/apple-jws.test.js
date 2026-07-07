"use strict"

const { test, before, after } = require("node:test")
const assert = require("node:assert/strict")

const { verifyAppleJws } = require("../api/billing/apple/jws")
const {
  buildChain, signJws, b64url, cleanup,
} = require("./helpers/appleCerts")

// One chain shared across the suite — generating certs is
// the slow part, and the tests only need one valid anchor
// plus one unrelated anchor to represent "wrong root".
let chain
let otherChain

const PAYLOAD = {
  bundleId: "dev.kaisho.app",
  productId: "dev.kaisho.app.companion.monthly",
  originalTransactionId: "1000000000000001",
  expiresDate: 1_900_000_000_000,
  environment: "Production",
}

before(() => {
  chain = buildChain()
  otherChain = buildChain()
})

after(() => {
  cleanup(chain)
  cleanup(otherChain)
})

test("verifies a well-formed JWS and returns the payload", () => {
  const jws = signJws(PAYLOAD, chain)
  const out = verifyAppleJws(jws, {
    trustedRoots: [chain.rootCert],
  })
  assert.equal(out.productId, PAYLOAD.productId)
  assert.equal(
    out.originalTransactionId, PAYLOAD.originalTransactionId,
  )
})

test("rejects a chain rooted at an untrusted CA", () => {
  const jws = signJws(PAYLOAD, chain)
  assert.throws(
    () => verifyAppleJws(jws, {
      trustedRoots: [otherChain.rootCert],
    }),
    /trusted Apple root/,
  )
})

test("rejects a tampered payload", () => {
  const jws = signJws(PAYLOAD, chain)
  const [h, , s] = jws.split(".")
  const forged = b64url(
    JSON.stringify({ ...PAYLOAD, productId: "team.hack" }),
  )
  const tampered = `${h}.${forged}.${s}`
  assert.throws(
    () => verifyAppleJws(tampered, {
      trustedRoots: [chain.rootCert],
    }),
    /signature verification failed/,
  )
})

test("rejects when the certs are outside their validity", () => {
  const jws = signJws(PAYLOAD, chain)
  // Certs are valid ~10 years from mint; a far-future clock
  // puts them outside the window.
  assert.throws(
    () => verifyAppleJws(jws, {
      trustedRoots: [chain.rootCert],
      now: Date.parse("2099-01-01T00:00:00Z"),
    }),
    /validity window/,
  )
})

test("rejects a malformed JWS", () => {
  assert.throws(
    () => verifyAppleJws("not-a-jws", {
      trustedRoots: [chain.rootCert],
    }),
    /Malformed JWS/,
  )
})

test("rejects a non-ES256 alg", () => {
  // Hand-build a header claiming HS256 but keep a real x5c.
  const header = b64url(JSON.stringify({
    alg: "HS256", x5c: chain.x5c,
  }))
  const payload = b64url(JSON.stringify(PAYLOAD))
  const jws = `${header}.${payload}.${b64url("sig")}`
  assert.throws(
    () => verifyAppleJws(jws, {
      trustedRoots: [chain.rootCert],
    }),
    /Unsupported JWS alg/,
  )
})

test("rejects when no trusted roots are configured", () => {
  const jws = signJws(PAYLOAD, chain)
  assert.throws(
    () => verifyAppleJws(jws, { trustedRoots: [] }),
    /No trusted Apple roots/,
  )
})
