#!/usr/bin/env node
"use strict"

/**
 * Idempotent Stripe product + price creator for the
 * Track AI tier model (Hobby / Companion / Pro / Team
 * + Token Pack 500k).
 *
 * Uses STRIPE_SECRET_KEY from process.env (loaded from
 * ./.env if you launch via `node -r dotenv/config`
 * or via the wrapper below).
 *
 * Re-running is safe: each product/price is keyed by a
 * stable `lookup_key`. If a price with that lookup_key
 * already exists the script skips creation and reports
 * the existing ID.
 *
 * Usage:
 *   cd kaisho-cloud
 *   node scripts/create-stripe-products.js
 *
 * The script reads STRIPE_SECRET_KEY from ./.env
 * automatically (or honours an already-set env var).
 *
 * Output:
 *   - a table of products / prices that exist or were
 *     created
 *   - a copy-paste-ready env-var block at the end
 */

const fs = require("fs")
const path = require("path")
const Stripe = require("stripe")

// Tiny inline .env loader — avoids adding a dotenv dep
// just for a one-shot script. Only honours simple
// KEY=value lines, ignores comments and blanks.
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
    "node scripts/create-stripe-products.js " +
    "--confirm-live\n",
  )
  process.exit(1)
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// Stripe tax code for SaaS / cloud-hosted software,
// business-use variant. Personal-use is txcd_10103000;
// business-use is txcd_10103001. Kaisho's audience
// (freelancers, consultants, developers) is business-use,
// which Stripe Tax uses to apply the correct VAT per
// buyer jurisdiction (e.g. EU reverse-charge for B2B).
//   https://stripe.com/docs/tax/tax-codes
const SAAS_TAX_CODE = "txcd_10103001"

// ── Catalog ──────────────────────────────────────────────
//
// Each product gets one or more prices. `lookup_key` is the
// idempotency anchor — Stripe lets you find/upsert a price
// by it, so re-running the script does not create dupes.

const CATALOG = [
  {
    productKey: "kaisho_companion",
    productName: "Kaisho Companion",
    productDescription:
      "Local-first AI work companion with hosted token " +
      "quota, mobile PWA, and MCP gateway. 500k tokens " +
      "of a frontier model per month.",
    prices: [
      {
        lookupKey: "companion_monthly",
        nickname: "Companion (monthly)",
        unitAmount: 2900,
        currency: "eur",
        recurring: { interval: "month" },
      },
      {
        lookupKey: "companion_yearly",
        nickname: "Companion (yearly)",
        unitAmount: 29000,
        currency: "eur",
        recurring: { interval: "year" },
      },
    ],
  },
  {
    productKey: "kaisho_pro",
    productName: "Kaisho Pro",
    productDescription:
      "Companion + premium MCP integrations (Linear, " +
      "GitHub Projects, Google Calendar, Slack), 2M " +
      "tokens / month, priority cron-AI queue, " +
      "priority email support.",
    prices: [
      {
        lookupKey: "pro_monthly",
        nickname: "Pro (monthly)",
        unitAmount: 5900,
        currency: "eur",
        recurring: { interval: "month" },
      },
      {
        lookupKey: "pro_yearly",
        nickname: "Pro (yearly)",
        unitAmount: 59000,
        currency: "eur",
        recurring: { interval: "year" },
      },
    ],
  },
  {
    productKey: "kaisho_team",
    productName: "Kaisho Team",
    productDescription:
      "Pro features + shared workspace, team cron " +
      "agents, RBAC, audit log. Per-seat pricing, " +
      "minimum 2 seats.",
    prices: [
      {
        lookupKey: "team_monthly",
        nickname: "Team (per seat / month)",
        unitAmount: 9900,
        currency: "eur",
        recurring: { interval: "month" },
      },
      {
        lookupKey: "team_yearly",
        nickname: "Team (per seat / year)",
        unitAmount: 99000,
        currency: "eur",
        recurring: { interval: "year" },
      },
    ],
  },
  {
    productKey: "kaisho_token_pack_500k",
    productName: "Kaisho Token Pack — 500k",
    productDescription:
      "One-time overage pack: 500,000 additional " +
      "frontier-model tokens added to your current " +
      "month's allowance.",
    prices: [
      {
        lookupKey: "token_pack_500k",
        nickname: "Token Pack 500k (one-time)",
        unitAmount: 1500,
        currency: "eur",
      },
    ],
  },
]

// ── Helpers ──────────────────────────────────────────────

async function findProductByMetadata(productKey) {
  const search = await stripe.products.search({
    query:
      `metadata['product_key']:'${productKey}'` +
      ` AND active:'true'`,
    limit: 1,
  })
  return search.data[0] || null
}

async function findPriceByLookupKey(lookupKey) {
  const list = await stripe.prices.list({
    lookup_keys: [lookupKey],
    active: true,
    limit: 1,
  })
  return list.data[0] || null
}

async function upsertProduct(spec) {
  const existing = await findProductByMetadata(
    spec.productKey,
  )
  if (existing) {
    if (existing.tax_code !== SAAS_TAX_CODE) {
      const updated = await stripe.products.update(
        existing.id,
        { tax_code: SAAS_TAX_CODE },
      )
      console.log(
        `  product  ${spec.productKey.padEnd(30)} ` +
        `${updated.id}  (tax_code updated)`,
      )
      return updated
    }
    console.log(
      `  product  ${spec.productKey.padEnd(30)} ` +
      `${existing.id}  (existing)`,
    )
    return existing
  }
  const created = await stripe.products.create({
    name: spec.productName,
    description: spec.productDescription,
    tax_code: SAAS_TAX_CODE,
    metadata: { product_key: spec.productKey },
  })
  console.log(
    `  product  ${spec.productKey.padEnd(30)} ` +
    `${created.id}  (created)`,
  )
  return created
}

async function upsertPrice(productId, priceSpec) {
  const existing = await findPriceByLookupKey(
    priceSpec.lookupKey,
  )
  if (existing) {
    console.log(
      `  price    ${priceSpec.lookupKey.padEnd(30)} ` +
      `${existing.id}  (existing)`,
    )
    return existing
  }
  const created = await stripe.prices.create({
    product: productId,
    nickname: priceSpec.nickname,
    unit_amount: priceSpec.unitAmount,
    currency: priceSpec.currency,
    recurring: priceSpec.recurring,
    lookup_key: priceSpec.lookupKey,
  })
  console.log(
    `  price    ${priceSpec.lookupKey.padEnd(30)} ` +
    `${created.id}  (created)`,
  )
  return created
}

// ── Run ──────────────────────────────────────────────────

async function main() {
  console.log(
    `\nStripe mode: ${isTestKey ? "TEST" : "LIVE"}\n`,
  )
  console.log("Creating / verifying products and prices:")

  const envLines = []

  for (const spec of CATALOG) {
    const product = await upsertProduct(spec)
    for (const priceSpec of spec.prices) {
      const price = await upsertPrice(
        product.id, priceSpec,
      )
      const envName =
        "STRIPE_PRICE_" +
        priceSpec.lookupKey.toUpperCase()
      envLines.push(`${envName}=${price.id}`)
    }
  }

  console.log("\nAdd these to ./.env:\n")
  for (const line of envLines) console.log(`  ${line}`)
  console.log("")
}

main().catch((err) => {
  console.error("\nFailed:", err.message)
  process.exit(1)
})
