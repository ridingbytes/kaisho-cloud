"use strict"

/**
 * @module ai/queue
 *
 * Concurrency limiter for upstream AI calls. Caps how many
 * requests hit the backend at once; at low load it is a
 * no-op, so it only bites under contention.
 *
 * It used to order the queue by plan, serving Pro and Team
 * ahead of Companion. There is one plan now, so every
 * request carried the same priority and the ordering was a
 * comparison that could not come out either way. The plan
 * argument travelled from four route handlers and the cron
 * worker through callModel to reach it.
 *
 * In-process only (per Node worker). Good enough for a
 * single-instance gateway; a multi-instance deployment
 * would move this to a shared queue.
 */

const MAX = parseInt(process.env.AI_MAX_CONCURRENCY, 10)
  || 8

let active = 0
/** @type {Array<Function>} */
const waiters = []

function acquire() {
  if (active < MAX) {
    active++
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    waiters.push(resolve)
  })
}

function release() {
  if (waiters.length === 0) {
    active = Math.max(0, active - 1)
    return
  }
  // Hand the slot to the next waiter, FIFO. active stays
  // unchanged -- the slot transfers directly.
  waiters.shift()()
}

/**
 * Run ``fn`` under the concurrency limiter. Always
 * releases, even on throw.
 *
 * @param {Function} fn - async () => result
 * @returns {Promise<*>}
 */
async function withLimit(fn) {
  await acquire()
  try {
    return await fn()
  } finally {
    release()
  }
}

module.exports = { withLimit }
