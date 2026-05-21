#!/usr/bin/env node
"use strict"

/**
 * Read-only Stripe setup audit.
 *
 * Lists products, prices, webhook endpoints + their
 * events, customer portal config, tax settings, and
 * payment methods. Compares against what the Track AI
 * tier model and the api/routes/stripe-webhook.js
 * handler require, and reports anything missing.
 */

const fs = require("fs")
const path = require("path")
const Stripe = require("stripe")

function loadDotenv(filePath) {
  if (!fs.existsSync(filePath)) return
  const text = fs.readFileSync(filePath, "utf8")
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

loadDotenv(path.join(__dirname, "..", ".env"))

if (!process.env.STRIPE_SECRET_KEY) {
  console.error("STRIPE_SECRET_KEY not set.")
  process.exit(1)
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const isTest =
  process.env.STRIPE_SECRET_KEY.startsWith("sk_test_")

const EXPECTED_LOOKUP_KEYS = [
  "companion_monthly",
  "companion_yearly",
  "pro_monthly",
  "pro_yearly",
  "team_monthly",
  "team_yearly",
  "token_pack_500k",
]

const EXPECTED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.deleted",
  "invoice.paid",
  "payment_intent.succeeded",
]

async function auditProducts() {
  console.log("\n── Products ──")
  const products = []
  for await (const p of stripe.products.list({
    limit: 100, active: true,
  })) {
    products.push(p)
  }
  console.log(`Found ${products.length} active product(s)`)
  for (const p of products) {
    console.log(
      `  ${p.name.padEnd(20)}  ` +
      `tax=${p.tax_code || "(none)"}  id=${p.id}`,
    )
  }
}

async function auditPrices() {
  console.log("\n── Prices ──")
  const prices = []
  for await (const pr of stripe.prices.list({
    limit: 100, active: true,
  })) {
    prices.push(pr)
  }
  const byKey = new Map(
    prices.filter((p) => p.lookup_key)
      .map((p) => [p.lookup_key, p]),
  )
  for (const key of EXPECTED_LOOKUP_KEYS) {
    const p = byKey.get(key)
    if (p) {
      const amt = (p.unit_amount / 100).toFixed(2)
      const interval =
        p.recurring?.interval || "one-time"
      console.log(
        `  ✓ ${key.padEnd(20)}  €${amt}  ${interval}  ` +
        `${p.id}`,
      )
    } else {
      console.log(`  ✗ MISSING lookup_key=${key}`)
    }
  }
  const unexpected = prices
    .filter((p) => p.lookup_key)
    .filter((p) => !EXPECTED_LOOKUP_KEYS.includes(
      p.lookup_key,
    ))
  if (unexpected.length) {
    console.log("  Unexpected active prices:")
    for (const p of unexpected) {
      console.log(
        `    ! ${p.lookup_key}  ${p.id}  ` +
        `€${(p.unit_amount / 100).toFixed(2)}`,
      )
    }
  }
}

async function auditWebhooks() {
  console.log("\n── Webhook endpoints ──")
  const eps = []
  for await (const ep of stripe.webhookEndpoints.list({
    limit: 100,
  })) {
    eps.push(ep)
  }
  if (!eps.length) {
    console.log("  ✗ NO webhook endpoints configured")
    return
  }
  for (const ep of eps) {
    console.log(`  ${ep.url}`)
    console.log(`    status=${ep.status}  id=${ep.id}`)
    const missing = EXPECTED_EVENTS.filter(
      (e) => !ep.enabled_events.includes(e),
    )
    const extra = ep.enabled_events.filter(
      (e) => !EXPECTED_EVENTS.includes(e),
    )
    if (missing.length === 0 && extra.length === 0) {
      console.log(
        `    ✓ events match (${ep.enabled_events.length})`,
      )
    } else {
      if (missing.length) {
        console.log(`    ✗ missing: ${missing.join(", ")}`)
      }
      if (extra.length) {
        console.log(`    ? extra:   ${extra.join(", ")}`)
      }
    }
  }
}

async function auditPortal() {
  console.log("\n── Customer Portal ──")
  try {
    const list =
      await stripe.billingPortal.configurations.list({
        limit: 5,
      })
    const def = list.data.find((c) => c.is_default)
    if (!def) {
      console.log(
        "  ✗ No default portal configuration. Users " +
        "cannot self-serve cancel/upgrade. Configure " +
        "via dashboard or the API.",
      )
      return
    }
    console.log(`  ✓ default config: ${def.id}`)
    const feats = def.features
    const flags = [
      ["customer_update", feats.customer_update.enabled],
      ["invoice_history", feats.invoice_history.enabled],
      ["payment_method_update",
        feats.payment_method_update.enabled],
      ["subscription_cancel",
        feats.subscription_cancel.enabled],
      ["subscription_update",
        feats.subscription_update.enabled],
    ]
    for (const [name, on] of flags) {
      console.log(`    ${on ? "✓" : "✗"} ${name}`)
    }
  } catch (err) {
    console.log(`  ✗ ${err.message}`)
  }
}

async function auditTax() {
  console.log("\n── Tax ──")
  try {
    const settings = await stripe.tax.settings.retrieve()
    console.log(
      `  status: ${settings.status}` +
      (settings.status_details?.pending?.missing_fields
        ? `  pending fields: ${settings.status_details.pending.missing_fields.join(", ")}`
        : ""),
    )
    console.log(
      `  default tax behavior: ` +
      `${settings.defaults?.tax_behavior || "(unset)"}`,
    )
    console.log(
      `  default tax code: ` +
      `${settings.defaults?.tax_code || "(unset)"}`,
    )
  } catch (err) {
    console.log(`  ✗ Stripe Tax not retrievable: ${err.message}`)
  }
}

async function auditAccount() {
  console.log("\n── Account ──")
  const acct = await stripe.accounts.retrieve()
  console.log(`  ${acct.business_profile?.name || "(no name)"}`)
  console.log(
    `  statement_descriptor: ` +
    `${acct.settings?.payments?.statement_descriptor || "(unset)"}`,
  )
  console.log(
    `  charges_enabled: ${acct.charges_enabled}  ` +
    `payouts_enabled: ${acct.payouts_enabled}`,
  )
  console.log(
    `  default_currency: ${acct.default_currency}`,
  )
}

async function main() {
  console.log(
    `\nStripe setup audit (${isTest ? "TEST" : "LIVE"} mode)`,
  )
  await auditAccount()
  await auditProducts()
  await auditPrices()
  await auditWebhooks()
  await auditPortal()
  await auditTax()
  console.log("")
}

main().catch((err) => {
  console.error("\n✗ Failed:", err.message)
  process.exit(1)
})
