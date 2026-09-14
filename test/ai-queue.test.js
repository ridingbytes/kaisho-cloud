"use strict"

// The AI concurrency limiter. No database, no network.

const { test } = require("node:test")
const assert = require("node:assert/strict")

process.env.AI_MAX_CONCURRENCY = "2"
const { withLimit } = require("../api/ai/queue")

/** A promise plus its resolver. */
function deferred() {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}

test("ai queue: caps concurrency and serves FIFO", async () => {
  const started = []
  const gates = [deferred(), deferred(), deferred(), deferred()]

  const runs = gates.map((gate, i) =>
    withLimit(async () => {
      started.push(i)
      await gate.promise
      return i
    }),
  )

  // Two slots, so two run and two wait.
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(started, [0, 1])

  // Finishing one admits exactly the next in line.
  gates[0].resolve()
  await runs[0]
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(started, [0, 1, 2])

  gates[1].resolve()
  await runs[1]
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(started, [0, 1, 2, 3])

  gates[2].resolve()
  gates[3].resolve()
  assert.deepEqual(await Promise.all(runs), [0, 1, 2, 3])
})

test("ai queue: a throwing task releases its slot", async () => {
  await assert.rejects(
    withLimit(async () => { throw new Error("boom") }),
    /boom/,
  )
  // If the slot leaked, four more tasks at a cap of two
  // would never all finish.
  const out = await Promise.all(
    [1, 2, 3, 4].map((n) => withLimit(async () => n)),
  )
  assert.deepEqual(out, [1, 2, 3, 4])
})
