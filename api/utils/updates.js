"use strict"

/**
 * Generic helper for building Supabase update objects
 * from request bodies.
 */

/**
 * Extract non-undefined fields from body into an update
 * object.
 *
 * @param {object} body - Express request body.
 * @param {string[]} fields - Field names to consider.
 * @returns {object} Object with only the defined fields.
 */
function buildUpdates(body, fields) {
  const updates = {}
  for (const field of fields) {
    if (body[field] !== undefined) {
      updates[field] = body[field]
    }
  }
  return updates
}

module.exports = { buildUpdates }
