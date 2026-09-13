"use strict"

// Admin provisioning service against real Postgres. Gated on
// TEST_DATABASE_URL.
const url = process.env.TEST_DATABASE_URL
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
  setPassword, deleteAccount, listAccounts,
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

  // set password: verify the hash changes and old != new
  const before = await supabase
    .from("users").select("password_hash").eq("id", r.userId).single()
  assert.deepEqual(await setPassword(r.userId, "newpassw0rd"), {
    found: true,
  })
  const after = await supabase
    .from("users").select("password_hash").eq("id", r.userId).single()
  assert.notEqual(after.data.password_hash, before.data.password_hash)
  assert.equal(
    await bcrypt.compare("newpassw0rd", after.data.password_hash), true)

  // list includes this account, with stats, without secrets
  const list = await listAccounts()
  const mine = list.find((a) => a.id === r.userId)
  assert.ok(mine)
  assert.equal(mine.email, email)
  assert.equal("password_hash" in mine, false)
  assert.equal("api_key_hash" in mine, false)
  assert.equal(typeof mine.clock_entries, "number")
  assert.equal("last_change_at" in mine, true)

  // unknown ids: null / not found, no throw
  assert.equal(await generateApiKey(NIL), null)
  assert.deepEqual(await setDisabled(NIL, true), { found: false })
  assert.deepEqual(await setPassword(NIL, "whatever8"), { found: false })
  assert.deepEqual(await deleteAccount(NIL), { found: false })

  // duplicate email -> 409
  const dup = await createAccount({ email })
  assert.equal(dup.error.status, 409)

  // delete removes the account
  assert.deepEqual(await deleteAccount(r.userId), { found: true })
  const gone = await supabase
    .from("users").select("id").eq("id", r.userId).maybeSingle()
  assert.equal(gone.data, null)
})
