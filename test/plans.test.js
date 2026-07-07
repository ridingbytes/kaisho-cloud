"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")

const {
  planRank, maxPlan, resolveEffectivePlan,
} = require("../api/billing/plans")

const HOUR = 3600_000
const NOW = 1_700_000_000_000

test("planRank orders the tiers", () => {
  assert.equal(planRank("free"), 0)
  assert.equal(planRank("companion"), 1)
  assert.equal(planRank("pro"), 2)
  assert.equal(planRank("team"), 3)
  assert.equal(planRank(null), 0)
  assert.equal(planRank("bogus"), 0)
})

test("maxPlan returns the higher tier", () => {
  assert.equal(maxPlan("companion", "pro"), "pro")
  assert.equal(maxPlan("team", "companion"), "team")
  assert.equal(maxPlan(null, "companion"), "companion")
  assert.equal(maxPlan(null, null), "free")
})

test("no sources → free", () => {
  assert.equal(
    resolveEffectivePlan({
      stripePlan: null, applePlan: null,
      appleExpiresAt: null, now: NOW,
    }),
    "free",
  )
})

test("Stripe-only grant", () => {
  assert.equal(
    resolveEffectivePlan({
      stripePlan: "pro", applePlan: null,
      appleExpiresAt: null, now: NOW,
    }),
    "pro",
  )
})

test("active Apple grant counts", () => {
  assert.equal(
    resolveEffectivePlan({
      stripePlan: null, applePlan: "companion",
      appleExpiresAt: new Date(NOW + HOUR).toISOString(),
      now: NOW,
    }),
    "companion",
  )
})

test("expired Apple grant does not count", () => {
  assert.equal(
    resolveEffectivePlan({
      stripePlan: null, applePlan: "companion",
      appleExpiresAt: new Date(NOW - HOUR).toISOString(),
      now: NOW,
    }),
    "free",
  )
})

test("Apple expiry never wipes an active Stripe plan", () => {
  // The exact scenario the reconciler must protect: Apple
  // lapsed, Stripe still active → keep the Stripe tier.
  assert.equal(
    resolveEffectivePlan({
      stripePlan: "pro", applePlan: "companion",
      appleExpiresAt: new Date(NOW - HOUR).toISOString(),
      now: NOW,
    }),
    "pro",
  )
})

test("highest active tier wins across sources", () => {
  assert.equal(
    resolveEffectivePlan({
      stripePlan: "companion", applePlan: "team",
      appleExpiresAt: new Date(NOW + HOUR).toISOString(),
      now: NOW,
    }),
    "team",
  )
})

test("missing Apple expiry means no Apple grant", () => {
  assert.equal(
    resolveEffectivePlan({
      stripePlan: null, applePlan: "companion",
      appleExpiresAt: null, now: NOW,
    }),
    "free",
  )
})
