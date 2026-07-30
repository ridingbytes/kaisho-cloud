"use strict"

// Admin provisioning service against real Postgres. Requires
// postgres-mode env; gated on TEST_DATABASE_URL.
const url = process.env.TEST_DATABASE_URL
process.env.DB_BACKEND = "postgres"
process.env.JWT_SECRET = process.env.JWT_SECRET || "admin-test-secret"
process.env.DATABASE_URL =
  url || process.env.DATABASE_URL || "postgres://localhost/none"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const bcrypt = require("bcryptjs")
const { Client } = require("pg")

const { migrate } = require("../db/migrate")
const {
  createAccount, generateApiKey, setDisabled,
} = require("../api/services/accounts")
const { supabase } = require("../api/db")

const NIL = "00000000-0000-0000-0000-000000000000"
const opts = { skip: url ? false : "set TEST_DATABASE_URL to run" }

test("provision, rotate, disable, enable", opts, async () => {
  const setup = new Client({ connectionString: url })
  await setup.connect()
  await migrate(setup)
  await setup.end()

  const email = `prov${Date.now()}@x.com`

  // provision
  const r = await createAccount({ email, password: "pw12345678" })
  assert.equal(r.error, undefined)
  const token = await generateApiKey(r.userId)
  assert.ok(token)

  // the sync token is a real API key: prefix + bcrypt hash match
  const row = await supabase
    .from("users")
    .select("api_key_hash, api_key_prefix, disabled_at")
    .eq("id", r.userId).single()
  assert.equal(row.data.api_key_prefix, token.slice(0, 8))
  assert.equal(await bcrypt.compare(token, row.data.api_key_hash), true)
  assert.equal(row.data.disabled_at, null)

  // disable stamps disabled_at
  assert.deepEqual(await setDisabled(r.userId, true), { found: true })
  const dis = await supabase
    .from("users").select("disabled_at").eq("id", r.userId).single()
  assert.ok(dis.data.disabled_at)

  // enable clears it
  await setDisabled(r.userId, false)
  const en = await supabase
    .from("users").select("disabled_at").eq("id", r.userId).single()
  assert.equal(en.data.disabled_at, null)

  // rotate issues a different token
  const token2 = await generateApiKey(r.userId)
  assert.notEqual(token2, token)

  // unknown ids: null / not found, no throw
  assert.equal(await generateApiKey(NIL), null)
  assert.deepEqual(await setDisabled(NIL, true), { found: false })

  // duplicate email -> 409
  const dup = await createAccount({ email })
  assert.equal(dup.error.status, 409)
})
