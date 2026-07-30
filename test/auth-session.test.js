"use strict"

// Self-owned auth (postgres mode). Set env before requiring
// the module so it initializes in OWN_AUTH mode. No DB needed:
// the pg pool is constructed but never queried here.
process.env.DB_BACKEND = "postgres"
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgres://localhost/none"
process.env.JWT_SECRET = "unit-test-secret"

const { test } = require("node:test")
const assert = require("node:assert/strict")

const {
  OWN_AUTH,
  signAccess,
  signRefresh,
  verifyAccess,
  verifyRefresh,
  hashPassword,
  verifyPassword,
} = require("../api/auth/session")

test("runs in own-auth mode", () => {
  assert.equal(OWN_AUTH, true)
})

test("access token round-trips with claims", async () => {
  const token = signAccess("user-1", "a@b.com")
  const v = await verifyAccess(token)
  assert.deepEqual(v, { userId: "user-1", email: "a@b.com" })
})

test("refresh token round-trips", () => {
  const v = verifyRefresh(signRefresh("user-1"))
  assert.deepEqual(v, { userId: "user-1" })
})

test("token type is enforced", async () => {
  // An access token must not pass as a refresh token...
  assert.equal(verifyRefresh(signAccess("u", "e")), null)
  // ...and a refresh token must not authenticate a request.
  assert.equal(await verifyAccess(signRefresh("u")), null)
})

test("garbage and tampered tokens are rejected", async () => {
  assert.equal(await verifyAccess("not-a-jwt"), null)
  const t = signAccess("u", "e")
  assert.equal(await verifyAccess(t + "x"), null)
})

test("a token signed with another secret is rejected", async () => {
  const jwt = require("jsonwebtoken")
  const forged = jwt.sign(
    { sub: "u", typ: "access" }, "wrong-secret",
  )
  assert.equal(await verifyAccess(forged), null)
})

test("password hashes verify and reject", async () => {
  const hash = await hashPassword("s3cret-pw")
  assert.equal(await verifyPassword("s3cret-pw", hash), true)
  assert.equal(await verifyPassword("wrong", hash), false)
  // Missing hash never matches.
  assert.equal(await verifyPassword("x", null), false)
})
