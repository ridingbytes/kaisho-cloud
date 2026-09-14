"use strict"

// WebSocket authentication against real Postgres. Gated on
// TEST_DATABASE_URL.
//
// The case that matters is the SECOND call with the same
// key: the first populates the API-key cache, and a
// mismatched cache signature used to make every later
// connect fail with 4001 while the same key kept working
// over HTTP.
const url = process.env.TEST_DATABASE_URL
process.env.JWT_SECRET = process.env.JWT_SECRET || "ws-test-secret"
process.env.DATABASE_URL =
  url || process.env.DATABASE_URL || "postgres://localhost/none"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const { Client } = require("pg")

const { migrate } = require("../db/migrate")
const {
  createAccount, generateApiKey, setDisabled, deleteAccount,
} = require("../api/services/accounts")
const { signAccess } = require("../api/auth/session")
const { authenticate } = require("../api/ws")

const opts = { skip: url ? false : "set TEST_DATABASE_URL to run" }

test("ws auth: api key, repeated connects, jwt", opts, async () => {
  const setup = new Client({ connectionString: url })
  await setup.connect()
  await migrate(setup)
  await setup.end()

  const email = `ws${Date.now()}@x.com`
  const { userId } = await createAccount({ email })
  const key = await generateApiKey(userId)

  // First connect: bcrypt path, populates the cache.
  assert.equal(await authenticate("", key), userId)
  // Second and third: cache path. These are the ones that
  // used to close the socket with 4001.
  assert.equal(await authenticate("", key), userId)
  assert.equal(await authenticate("", key), userId)

  // A wrong key is rejected whether or not a real one was
  // just cached.
  assert.equal(await authenticate("", "not-a-key"), null)

  // JWTs take the same path as the HTTP middleware.
  assert.equal(await authenticate(signAccess(userId, email), ""), userId)
  assert.equal(await authenticate("garbage.jwt.here", ""), null)

  // A disabled account loses its socket, matching the 403
  // requireApiKey answers over HTTP. setDisabled clears the
  // auth cache, so the next call takes the bcrypt path.
  await setDisabled(userId, true)
  assert.equal(await authenticate("", key), null)

  await deleteAccount(userId)
})
