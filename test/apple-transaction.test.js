"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")

const {
  processAppleTransaction, AppleTransactionError,
} = require("../api/billing/apple/transaction")

const NOW = 1_700_000_000_000
const HOUR = 3600_000

const BASE = {
  bundleId: "dev.kaisho.app",
  environments: ["Production"],
  now: NOW,
}

/**
 * A valid, active Companion transaction payload.
 * @param {object} over - Fields to override.
 */
function payload(over = {}) {
  return {
    bundleId: "dev.kaisho.app",
    productId: "dev.kaisho.app.companion.monthly",
    originalTransactionId: "1000000000000001",
    expiresDate: NOW + 30 * 24 * HOUR,
    environment: "Production",
    ...over,
  }
}

/**
 * Assert processing throws with a given reason code.
 * @param {object} p - Payload.
 * @param {object} opts - Options.
 * @param {string} code - Expected error code.
 */
function assertRejected(p, opts, code) {
  assert.throws(
    () => processAppleTransaction(p, opts),
    (err) => {
      assert.ok(err instanceof AppleTransactionError)
      assert.equal(err.code, code)
      return true
    },
  )
}

test("grants Companion for a valid transaction", () => {
  const grant = processAppleTransaction(payload(), BASE)
  assert.equal(grant.plan, "companion")
  assert.equal(grant.originalTransactionId, "1000000000000001")
  assert.equal(grant.environment, "Production")
  assert.equal(
    grant.expiresAt,
    new Date(NOW + 30 * 24 * HOUR).toISOString(),
  )
})

test("yearly product also maps to Companion", () => {
  const grant = processAppleTransaction(
    payload({ productId: "dev.kaisho.app.companion.yearly" }),
    BASE,
  )
  assert.equal(grant.plan, "companion")
})

test("rejects a wrong bundle id", () => {
  assertRejected(
    payload({ bundleId: "com.evil.app" }), BASE, "wrong_bundle_id",
  )
})

test("rejects a wrong environment", () => {
  assertRejected(
    payload({ environment: "Sandbox" }), BASE, "wrong_environment",
  )
})

test("accepts Sandbox when configured", () => {
  const grant = processAppleTransaction(
    payload({ environment: "Sandbox" }),
    { ...BASE, environments: ["Production", "Sandbox"] },
  )
  assert.equal(grant.plan, "companion")
})

test("rejects an unknown product", () => {
  assertRejected(
    payload({ productId: "dev.kaisho.app.enterprise" }),
    BASE, "unknown_product",
  )
})

test("rejects a revoked (refunded) transaction", () => {
  assertRejected(
    payload({ revocationDate: NOW - HOUR }), BASE, "revoked",
  )
})

test("rejects an already-expired subscription", () => {
  assertRejected(
    payload({ expiresDate: NOW - HOUR }), BASE, "expired",
  )
})

test("rejects a transaction with no expiry", () => {
  const p = payload()
  delete p.expiresDate
  assertRejected(p, BASE, "not_subscription")
})

test("rejects a payload missing originalTransactionId", () => {
  const p = payload()
  delete p.originalTransactionId
  assertRejected(p, BASE, "missing_original_txn")
})
