"use strict"

/**
 * Wraps an async Express route handler so that rejected
 * promises are forwarded to the Express error middleware.
 *
 * @param {Function} fn - Async route handler (req, res, next).
 * @returns {Function} Express-compatible route handler.
 */
function asyncHandler(fn) {
  return (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next)
}

module.exports = { asyncHandler }
