"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")

// BILLING_ENABLED gates new checkout / token-pack purchases
// during the open-source transition. It is read once at
// config load from process.env, so each case requires the
// config module fresh.
function loadBillingEnabled(value) {
  process.env.SUPABASE_URL = "https://example.supabase.co"
  process.env.SUPABASE_SERVICE_KEY = "test-service-key"
  if (value === undefined) {
    delete process.env.BILLING_ENABLED
  } else {
    process.env.BILLING_ENABLED = value
  }
  delete require.cache[require.resolve("../api/config")]
  return require("../api/config").BILLING_ENABLED
}

test("billing is closed by default", () => {
  assert.equal(loadBillingEnabled(undefined), false)
})

test("billing stays closed for non-true values", () => {
  assert.equal(loadBillingEnabled("false"), false)
  assert.equal(loadBillingEnabled("1"), false)
  assert.equal(loadBillingEnabled("yes"), false)
})

test("billing opens only for the exact string true", () => {
  assert.equal(loadBillingEnabled("true"), true)
})
