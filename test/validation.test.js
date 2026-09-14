"use strict"

// Request validation. No database needed.

const { test } = require("node:test")
const assert = require("node:assert/strict")

const { syncChangesQuerySchema } = require("../api/validation")

test("sync changes: since must be a timestamp", () => {
  // The cursor is a value the server handed out.
  for (const ok of [
    "1970-01-01T00:00:00Z",
    "2026-09-13T22:16:05.000Z",
    "2026-09-13T22:16:05+02:00",
  ]) {
    assert.equal(
      syncChangesQuerySchema.safeParse({ since: ok }).success,
      true, ok,
    )
  }

  // Absent keeps working: the route defaults to the epoch.
  assert.equal(syncChangesQuerySchema.safeParse({}).success, true)

  // "0" is the value from #119. It reached Postgres, which
  // answered 22008, and the route turned that into a 500.
  // Date.parse() reads it as the year 2000, so a lenient
  // check would have accepted it and returned a window
  // nobody asked for.
  for (const bad of ["0", "", "nonsense", "2026-09-13", "1e9"]) {
    const r = syncChangesQuerySchema.safeParse({ since: bad })
    assert.equal(r.success, false, bad)
    assert.match(r.error.issues[0].message, /^since must be/)
  }

  // limit still coerces from the query string
  const lim = syncChangesQuerySchema.safeParse({ limit: "50" })
  assert.equal(lim.success, true)
  assert.equal(lim.data.limit, 50)
  assert.equal(
    syncChangesQuerySchema.safeParse({ limit: "-1" }).success, false)
})
