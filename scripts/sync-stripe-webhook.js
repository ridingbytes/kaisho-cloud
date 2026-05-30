#!/usr/bin/env node
"use strict"

/**
 * Idempotent Stripe webhook endpoint syncer.
 *
 * Ensures the Stripe webhook endpoint at WEBHOOK_URL
 * exists and subscribes to the exact event list the
 * api/routes/stripe-webhook.js handler needs.
 *
 * Re-running is safe:
 *   - If the endpoint doesn't exist, it is created and
 *     the new signing secret is printed.
 *   - If it exists and the event set already matches, the
 *     script prints "no changes" and exits.
 *   - If it exists but the event set differs, the script
 *     updates the subscription in place. The signing
 *     secret stays the same.
 *
 * Usage:
 *   cd kaisho-cloud
 *   node scripts/sync-stripe-webhook.js
 *
 * Configuration (./.env):
 *   STRIPE_SECRET_KEY  - required
 *   WEBHOOK_URL        - optional, defaults to
 *                        https://cloud.kaisho.dev
 *                        /billing/webhook/stripe
 *
 * Live mode requires --confirm-live to prevent footguns.
 */

const path = require("path")
const Stripe = require("stripe")
const { loadDotenv } = require("./_dotenv")

loadDotenv(path.join(__dirname, "..", ".env"))

if (!process.env.STRIPE_SECRET_KEY) {
  console.error(
    "STRIPE_SECRET_KEY is not set in ./.env or env.",
  )
  process.exit(1)
}

const isTestKey =
  process.env.STRIPE_SECRET_KEY.startsWith("sk_test_")
const confirmLive = process.argv.includes("--confirm-live")
if (!isTestKey && !confirmLive) {
  console.error(
    "\n⚠  LIVE-MODE STRIPE KEY detected. To proceed, " +
    "re-run with --confirm-live:\n\n" +
    "  STRIPE_SECRET_KEY=sk_live_... " +
    "node scripts/sync-stripe-webhook.js " +
    "--confirm-live\n",
  )
  process.exit(1)
}

const WEBHOOK_URL =
  process.env.WEBHOOK_URL ||
  "https://cloud.kaisho.dev/billing/webhook/stripe"

// Source of truth: every event our handler dispatches on
// in api/routes/stripe-webhook.js. Keep in sync with the
// switch in handleStripeEvent().
const REQUIRED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.deleted",
  "invoice.paid",
  "payment_intent.succeeded",
]

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

async function findEndpoint(url) {
  for await (const ep of stripe.webhookEndpoints.list({
    limit: 100,
  })) {
    if (ep.url === url) return ep
  }
  return null
}

function setsEqual(a, b) {
  if (a.length !== b.length) return false
  const sa = new Set(a)
  return b.every((x) => sa.has(x))
}

async function main() {
  const mode = isTestKey ? "TEST" : "LIVE"
  console.log(
    `\nSyncing Stripe webhook (${mode} mode)`,
  )
  console.log(`  URL:    ${WEBHOOK_URL}`)
  console.log(
    `  Events: ${REQUIRED_EVENTS.length} ` +
    `(${REQUIRED_EVENTS.join(", ")})\n`,
  )

  const existing = await findEndpoint(WEBHOOK_URL)

  if (!existing) {
    const created = await stripe.webhookEndpoints.create({
      url: WEBHOOK_URL,
      enabled_events: REQUIRED_EVENTS,
      description:
        "Kaisho Cloud — Track AI plan + token-pack events",
    })
    console.log("✓ Created new endpoint")
    console.log(`  ID:     ${created.id}`)
    console.log(`  Secret: ${created.secret}`)
    console.log(
      "\n→ Copy the secret above into ./.env as " +
      "STRIPE_WEBHOOK_SECRET, then restart the API.\n",
    )
    return
  }

  console.log(`Found existing endpoint ${existing.id}`)
  console.log(
    `  Subscribed: ${existing.enabled_events.length} ` +
    `event(s)`,
  )

  if (setsEqual(existing.enabled_events, REQUIRED_EVENTS)) {
    console.log("\n✓ Event set already matches. No changes.\n")
    return
  }

  const added = REQUIRED_EVENTS.filter(
    (e) => !existing.enabled_events.includes(e),
  )
  const removed = existing.enabled_events.filter(
    (e) => !REQUIRED_EVENTS.includes(e),
  )

  console.log(
    `  + add:    ${added.join(", ") || "(none)"}`,
  )
  console.log(
    `  - remove: ${removed.join(", ") || "(none)"}`,
  )

  await stripe.webhookEndpoints.update(existing.id, {
    enabled_events: REQUIRED_EVENTS,
  })

  console.log("\n✓ Endpoint updated. Signing secret unchanged.\n")
}

main().catch((err) => {
  console.error("\n✗ Failed:", err.message)
  process.exit(1)
})
