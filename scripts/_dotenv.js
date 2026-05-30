"use strict"

/**
 * Tiny .env loader for one-shot scripts.
 *
 * Avoids adding a `dotenv` dependency for the scripts in
 * this directory. Only honours simple `KEY=value` lines,
 * with optional surrounding single or double quotes; skips
 * blanks and comment lines. Existing `process.env` values
 * win, so explicit `KEY=... node scripts/foo.js` overrides
 * the file.
 *
 * Usage:
 *   const path = require("path")
 *   const { loadDotenv } = require("./_dotenv")
 *   loadDotenv(path.join(__dirname, "..", ".env"))
 *
 * @param {string} filePath - Absolute path to the .env file.
 */

const fs = require("fs")

function loadDotenv(filePath) {
  if (!fs.existsSync(filePath)) return
  const text = fs.readFileSync(filePath, "utf8")
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

module.exports = { loadDotenv }
