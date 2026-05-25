"use strict"

/**
 * @module ai/queue
 *
 * Priority-aware concurrency limiter for upstream AI
 * calls. Caps how many requests hit the backend at once;
 * when saturated, Pro/Team requests are served ahead of
 * Companion. At low load it's a no-op (slots are free), so
 * it only bites under contention — which is exactly when
 * the Pro "priority" promise should matter.
 *
 * In-process only (per Node worker). Good enough for a
 * single-instance gateway; a multi-instance deployment
 * would move this to a shared queue.
 */

const MAX = parseInt(process.env.AI_MAX_CONCURRENCY, 10)
  || 8

let active = 0
/** @type {Array<{priority: number, resolve: Function}>} */
const waiters = []

/**
 * Map a plan to a queue priority (higher served first).
 *
 * @param {string} plan
 * @returns {number}
 */
function priorityFor(plan) {
  return plan === "pro" || plan === "team" ? 2 : 1
}

function acquire(priority) {
  if (active < MAX) {
    active++
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    waiters.push({ priority, resolve })
  })
}

function release() {
  if (waiters.length === 0) {
    active = Math.max(0, active - 1)
    return
  }
  // Hand the slot to the highest-priority waiter, FIFO
  // within the same priority. active stays unchanged — the
  // slot transfers directly.
  let idx = 0
  for (let i = 1; i < waiters.length; i++) {
    if (waiters[i].priority > waiters[idx].priority) {
      idx = i
    }
  }
  const next = waiters.splice(idx, 1)[0]
  next.resolve()
}

/**
 * Run ``fn`` under the concurrency limiter at the given
 * plan's priority. Always releases, even on throw.
 *
 * @param {string} plan
 * @param {Function} fn - async () => result
 * @returns {Promise<*>}
 */
async function withPriority(plan, fn) {
  await acquire(priorityFor(plan))
  try {
    return await fn()
  } finally {
    release()
  }
}

module.exports = { withPriority, priorityFor }
