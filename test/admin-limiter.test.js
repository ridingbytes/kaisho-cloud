"use strict"

// The admin router's rate limiter. No database: every
// request under test is rejected at the key comparison,
// which happens before any handler runs.

process.env.JWT_SECRET = process.env.JWT_SECRET || "limiter-test-secret"
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgres://localhost/none"
process.env.ADMIN_API_KEY = "k".repeat(64)

const { test } = require("node:test")
const assert = require("node:assert/strict")
const express = require("express")

const adminRoutes = require("../api/routes/admin")

/** Run fn against a throwaway server mounting /admin. */
async function withServer(fn) {
  const app = express()
  app.set("trust proxy", 1)
  app.use(express.json())
  app.use("/admin", adminRoutes)
  const server = app.listen(0)
  await new Promise((r) => server.once("listening", r))
  try {
    const { port } = server.address()
    return await fn((key, ip) => fetch(
      `http://127.0.0.1:${port}/admin/accounts`,
      {
        headers: {
          "Authorization": "Bearer " + key,
          "X-Forwarded-For": ip,
        },
      },
    ).then((r) => r.status))
  } finally {
    server.close()
  }
}

test("admin: wrong keys are throttled, per IP", async () => {
  await withServer(async (hit) => {
    const attacker = "203.0.113.7"
    const seen = []
    for (let i = 0; i < 25; i++) {
      seen.push(await hit("wrong" + i, attacker))
    }
    // The first attempts are refused on their merits; the
    // rest never reach the key comparison. Before this
    // limiter existed, forty attempts in a row all
    // answered 401 at full speed -- measured against the
    // live server.
    assert.equal(seen[0], 401)
    assert.equal(seen.at(-1), 429)
    assert.ok(
      seen.filter((s) => s === 429).length >= 4,
      `expected throttling, got ${seen.join(" ")}`,
    )

    // One attacker does not lock out the operator: the
    // budget is keyed by IP.
    assert.notEqual(await hit("wrong", "198.51.100.3"), 429)
  })
})
