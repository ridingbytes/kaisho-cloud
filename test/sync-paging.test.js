"use strict"

// Paging over /sync/<resource>/changes against real
// Postgres. Gated on TEST_DATABASE_URL.
//
// The subject is the page boundary. The cursor is a bare
// timestamp and the next pull asks for updated_at > cursor,
// so a page that ends mid-timestamp used to drop every
// remaining row carrying that value.
const url = process.env.TEST_DATABASE_URL
process.env.JWT_SECRET = process.env.JWT_SECRET || "paging-test-secret"
process.env.DATABASE_URL =
  url || process.env.DATABASE_URL || "postgres://localhost/none"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const express = require("express")
const { Client } = require("pg")

const { migrate } = require("../db/migrate")
const {
  createAccount, generateApiKey, deleteAccount,
} = require("../api/services/accounts")
const { db } = require("../api/db")
const { mountSyncResource } = require("../api/routes/syncResource")
const {
  validate, validateQuery, noteApplySchema, syncChangesQuerySchema,
} = require("../api/validation")
const { asyncHandler } = require("../api/utils/asyncHandler")

const opts = { skip: url ? false : "set TEST_DATABASE_URL to run" }

/** A notes router bound to one user, with auth stubbed. */
function buildApp(userId) {
  const app = express()
  app.use(express.json())
  const router = express.Router()
  mountSyncResource(router, {
    table: "notes",
    pathPrefix: "/notes",
    applyFields: ["title"],
    applySchema: noteApplySchema,
    rowToWire: (r) => ({ id: r.id, updated_at: r.updated_at }),
    wireToRow: (e, uid) => ({ ...e, user_id: uid }),
    broadcastEvent: "notes:changed",
  }, {
    db,
    broadcast: () => {},
    decideMerge: () => ({ action: "insert" }),
    insertWithRowRetry: async () => [],
    validate,
    validateQuery,
    syncChangesQuerySchema,
    requireAuth: (req, _res, next) => { req.userId = userId; next() },
    requireSync: (_req, _res, next) => next(),
    asyncHandler,
  })
  app.use("/sync", router)
  return app
}

/** GET /sync/notes/changes through the mounted router. */
function pull(app, query) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const { port } = server.address()
      try {
        const qs = new URLSearchParams(query).toString()
        const r = await fetch(
          `http://127.0.0.1:${port}/sync/notes/changes?${qs}`,
        )
        resolve(await r.json())
      } catch (e) {
        reject(e)
      } finally {
        server.close()
      }
    })
  })
}

/** Walk every page and return the ids seen, in order. */
async function pullAll(app, limit) {
  const seen = []
  let cursor = "1970-01-01T00:00:00Z"
  for (let i = 0; i < 50; i++) {
    const page = await pull(app, { since: cursor, limit })
    seen.push(...page.entries.map((e) => e.id))
    cursor = page.cursor
    if (!page.has_more) return seen
  }
  throw new Error("paging did not terminate")
}

test("sync paging: rows sharing a timestamp", opts, async () => {
  const setup = new Client({ connectionString: url })
  await setup.connect()
  await migrate(setup)
  await setup.end()

  const { userId } = await createAccount({
    email: `page${Date.now()}@x.com`,
  })
  await generateApiKey(userId)
  const app = buildApp(userId)

  const mk = async (id, stamp) => {
    const { error } = await db.from("notes").insert({
      id, user_id: userId, title: id,
      created_at: stamp, updated_at: stamp,
    })
    assert.equal(error, null)
  }

  // Five rows on one timestamp, then five on a later one.
  // With limit 3 the first page ends inside the first
  // group, which is the case that used to lose rows.
  const early = "2026-01-01T00:00:00.000Z"
  const late = "2026-01-02T00:00:00.000Z"
  for (let i = 0; i < 5; i++) await mk(`e${i}`, early)
  for (let i = 0; i < 5; i++) await mk(`l${i}`, late)

  const seen = await pullAll(app, 3)
  assert.equal(seen.length, 10)
  assert.equal(new Set(seen).size, 10)

  // A mixed page -- five early rows and one late one at
  // limit 6 -- is trimmed back to the timestamp boundary.
  // The dropped row returns on the next pull, because the
  // cursor now sits below it instead of on it.
  const mixed = await pull(app, {
    since: "1970-01-01T00:00:00Z", limit: 6,
  })
  assert.deepEqual(
    mixed.entries.map((e) => e.id).sort(),
    ["e0", "e1", "e2", "e3", "e4"],
  )
  assert.equal(mixed.has_more, true)
  const after = await pull(app, { since: mixed.cursor, limit: 6 })
  assert.deepEqual(
    after.entries.map((e) => e.id).sort(),
    ["l0", "l1", "l2", "l3", "l4"],
  )

  // A page that is entirely one timestamp cannot be
  // trimmed without emptying it, so it is returned whole
  // even though that exceeds the limit.
  const whole = await pull(app, { since: early, limit: 3 })
  assert.deepEqual(
    whole.entries.map((e) => e.id).sort(),
    ["l0", "l1", "l2", "l3", "l4"],
  )

  // A page smaller than the limit is the last one.
  const tail = await pull(app, { since: "1970-01-01T00:00:00Z", limit: 500 })
  assert.equal(tail.entries.length, 10)
  assert.equal(tail.has_more, false)

  await deleteAccount(userId)
})
