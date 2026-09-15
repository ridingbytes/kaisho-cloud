"use strict"

/**
 * @module utils/clocks
 *
 * Shared clock-entry helpers used by routes/clocks.js
 * and routes/sync.js. Provides duration parsing, period
 * date-range calculation, and DB-row-to-API formatting.
 */

// ── Duration parser ─────────────────────────────────────

/** Matches "1h", "30m", "1.5 hours", "90 minutes". */
const DURATION_SIMPLE =
  /^(\d+(?:\.\d+)?)\s*(h|hours?|m|min|mins|minutes?)$/i

/** Matches compound forms like "1h30m", "2h 15min". */
const DURATION_COMPOUND =
  /^(\d+)\s*h\s*(\d+)\s*(?:m|min|mins|minutes?)?$/i

/**
 * Parse a human-readable duration string into minutes.
 *
 * Supports formats like "1h", "30m", "1h30m", "1.5h",
 * "90 minutes".
 *
 * @param {string} str - Duration string to parse.
 * @returns {number|null} Duration in minutes, or null
 *   if the string is not recognised.
 */
function parseDuration(str) {
  const s = str.trim().toLowerCase()
  const cm = DURATION_COMPOUND.exec(s)
  if (cm) {
    return parseInt(cm[1]) * 60 + parseInt(cm[2])
  }
  const sm = DURATION_SIMPLE.exec(s)
  if (!sm) return null
  const value = parseFloat(sm[1])
  return sm[2].startsWith("h")
    ? Math.round(value * 60)
    : Math.round(value)
}

/**
 * Return the start date for a named calendar period.
 *
 * Week starts on Monday (ISO convention).
 *
 * @param {string} period - One of "today", "week",
 *   "month", "year".
 * @returns {{ from: Date }} Object with the period
 *   start date; callers compare entries against this.
 */
function periodRange(period) {
  const now = new Date()
  // Use UTC to match stored TIMESTAMPTZ values.
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const d = now.getUTCDate()
  const today = new Date(Date.UTC(y, m, d))
  switch (period) {
    case "today":
      return { from: today }
    case "week": {
      const day = today.getUTCDay()
      const monday = new Date(today)
      monday.setUTCDate(
        today.getUTCDate() - ((day + 6) % 7),
      )
      return { from: monday }
    }
    case "month":
      return { from: new Date(Date.UTC(y, m, 1)) }
    case "year":
      return { from: new Date(Date.UTC(y, 0, 1)) }
    default:
      return { from: today }
  }
}

/**
 * Format a clock_entries DB row into the API response
 * shape expected by the mobile app and web frontend.
 *
 * Computes duration_minutes from start_at/end_at when
 * the entry is complete (end_at present).
 *
 * @param {object} row - clock_entries row.
 * @returns {object} Formatted clock entry with
 *   camelCase-friendly field names.
 */
function formatEntry(row) {
  const durationMinutes =
    row.end_at && row.start_at
      ? Math.round(
          (new Date(row.end_at) -
            new Date(row.start_at)) /
            60000,
        )
      : null
  return {
    id: row.id,
    customer: row.customer || null,
    description: row.description || "",
    start: row.start_at,
    end: row.end_at || null,
    duration_minutes: durationMinutes,
    task_id: row.task_id || null,
    project: row.project || null,
    contract: row.contract || null,
    notes: row.notes || "",
    invoiced: row.invoiced || false,
    synced_at: row.synced_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at || null,
  }
}

module.exports = { parseDuration, periodRange, formatEntry }
