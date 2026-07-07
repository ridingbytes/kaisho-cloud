"use strict"

const { test, before, after } = require("node:test")
const assert = require("node:assert/strict")

const { verifyAppleJws } = require("../api/billing/apple/jws")
const {
  interpretNotification, grantExpiry,
} = require("../api/billing/apple/notifications")
const {
  buildChain, signJws, cleanup,
} = require("./helpers/appleCerts")

const NOW = 1_700_000_000_000
const HOUR = 3600_000
const FUTURE = NOW + 30 * 24 * HOUR

const BUNDLE = "dev.kaisho.app"

/**
 * A verified-transaction stand-in.
 * @param {object} over
 */
function txn(over = {}) {
  return {
    bundleId: BUNDLE,
    productId: "dev.kaisho.app.companion.monthly",
    originalTransactionId: "1000000000000001",
    expiresDate: FUTURE,
    environment: "Production",
    ...over,
  }
}

const BASE = { bundleId: BUNDLE, now: NOW, renewal: null }

test("DID_RENEW refreshes the grant", () => {
  const r = interpretNotification({
    notificationType: "DID_RENEW", txn: txn(), ...BASE,
  })
  assert.equal(r.action, "refresh")
  assert.equal(r.grant.plan, "companion")
  assert.equal(r.grant.originalTransactionId, "1000000000000001")
  assert.equal(r.grant.expiresAt, new Date(FUTURE).toISOString())
})

test("SUBSCRIBED refreshes the grant", () => {
  const r = interpretNotification({
    notificationType: "SUBSCRIBED", txn: txn(), ...BASE,
  })
  assert.equal(r.action, "refresh")
})

test("DID_CHANGE_RENEWAL_STATUS keeps access until expiry", () => {
  // Auto-renew off does not revoke — access lasts to expiry.
  const r = interpretNotification({
    notificationType: "DID_CHANGE_RENEWAL_STATUS",
    txn: txn(), ...BASE,
  })
  assert.equal(r.action, "refresh")
  assert.equal(r.grant.expiresAt, new Date(FUTURE).toISOString())
})

test("EXPIRED revokes the grant", () => {
  const r = interpretNotification({
    notificationType: "EXPIRED", txn: txn(), ...BASE,
  })
  assert.equal(r.action, "revoke")
  assert.equal(r.originalTransactionId, "1000000000000001")
})

test("REFUND revokes the grant", () => {
  const r = interpretNotification({
    notificationType: "REFUND", txn: txn(), ...BASE,
  })
  assert.equal(r.action, "revoke")
})

test("GRACE_PERIOD_EXPIRED revokes the grant", () => {
  const r = interpretNotification({
    notificationType: "GRACE_PERIOD_EXPIRED", txn: txn(), ...BASE,
  })
  assert.equal(r.action, "revoke")
})

test("DID_FAIL_TO_RENEW extends access through grace period", () => {
  // Transaction expired, but a grace period runs into the
  // future → keep access until the grace end.
  const graceEnd = NOW + 5 * 24 * HOUR
  const r = interpretNotification({
    notificationType: "DID_FAIL_TO_RENEW",
    txn: txn({ expiresDate: NOW - HOUR }),
    renewal: { gracePeriodExpiresDate: graceEnd },
    bundleId: BUNDLE, now: NOW,
  })
  assert.equal(r.action, "refresh")
  assert.equal(r.grant.expiresAt, new Date(graceEnd).toISOString())
})

test("a refresh-type past its expiry with no grace revokes", () => {
  const r = interpretNotification({
    notificationType: "DID_FAIL_TO_RENEW",
    txn: txn({ expiresDate: NOW - HOUR }),
    ...BASE,
  })
  assert.equal(r.action, "revoke")
})

test("unknown product is ignored", () => {
  const r = interpretNotification({
    notificationType: "DID_RENEW",
    txn: txn({ productId: "dev.kaisho.app.enterprise" }),
    ...BASE,
  })
  assert.equal(r.action, "ignore")
  assert.equal(r.reason, "unknown_product")
})

test("wrong bundle id is ignored", () => {
  const r = interpretNotification({
    notificationType: "DID_RENEW",
    txn: txn({ bundleId: "com.evil.app" }),
    ...BASE,
  })
  assert.equal(r.action, "ignore")
  assert.equal(r.reason, "wrong_bundle_id")
})

test("a notification with no transaction (TEST) is ignored", () => {
  const r = interpretNotification({
    notificationType: "TEST", txn: null, ...BASE,
  })
  assert.equal(r.action, "ignore")
  assert.equal(r.reason, "no_transaction")
})

test("grantExpiry takes the max of expiry and grace", () => {
  assert.equal(grantExpiry({ expiresDate: 100 }, null), 100)
  assert.equal(
    grantExpiry(
      { expiresDate: 100 }, { gracePeriodExpiresDate: 200 },
    ),
    200,
  )
  assert.equal(grantExpiry({}, null), 0)
})

// ── Nested-JWS end-to-end path ──────────────────────────

let chain

before(() => { chain = buildChain() })
after(() => { cleanup(chain) })

test("verifies an outer notification wrapping a signed txn", () => {
  const signedTransactionInfo = signJws(txn(), chain)
  const signedRenewalInfo = signJws(
    { autoRenewStatus: 1 }, chain,
  )
  const outer = signJws({
    notificationType: "DID_RENEW",
    notificationUUID: "uuid-abc",
    data: {
      bundleId: BUNDLE,
      environment: "Production",
      signedTransactionInfo,
      signedRenewalInfo,
    },
    version: "2.0",
  }, chain)

  const roots = [chain.rootCert]
  const notification = verifyAppleJws(outer, { trustedRoots: roots })
  assert.equal(notification.notificationType, "DID_RENEW")

  const verifiedTxn = verifyAppleJws(
    notification.data.signedTransactionInfo, { trustedRoots: roots },
  )
  const r = interpretNotification({
    notificationType: notification.notificationType,
    txn: verifiedTxn,
    renewal: null,
    bundleId: BUNDLE,
    now: NOW,
  })
  assert.equal(r.action, "refresh")
  assert.equal(r.grant.plan, "companion")
})
