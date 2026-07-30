"use strict"

/**
 * Plain-PostgreSQL migration runner.
 *
 * Applies db/schema.sql once as the baseline, then any
 * db/migrations/NNNN_*.sql files in lexical order, each in its
 * own transaction. Applied versions are recorded in the
 * schema_migrations table so re-runs are no-ops.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node db/migrate.js
 *   npm run migrate
 */

const fs = require("fs")
const path = require("path")
const { Client } = require("pg")

const BASELINE_VERSION = "0001_init"
const SCHEMA_FILE = path.join(__dirname, "schema.sql")
const MIGRATIONS_DIR = path.join(__dirname, "migrations")

// Session advisory-lock key so concurrent runners (e.g. the
// app and the migrate container starting together) serialize
// instead of racing on CREATE statements.
const LOCK_KEY = 4915231001

async function ensureMigrationsTable(client) {
  await client.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (" +
    "  version TEXT PRIMARY KEY," +
    "  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()" +
    ")",
  )
}

async function appliedVersions(client) {
  const res = await client.query(
    "SELECT version FROM schema_migrations",
  )
  return new Set(res.rows.map((r) => r.version))
}

/**
 * Apply one SQL file inside a transaction and record its
 * version. The whole file runs as a single multi-statement
 * query so it either fully applies or fully rolls back.
 */
async function applyVersion(client, version, sql) {
  await client.query("BEGIN")
  try {
    await client.query(sql)
    await client.query(
      "INSERT INTO schema_migrations (version) VALUES ($1)",
      [version],
    )
    await client.query("COMMIT")
  } catch (err) {
    await client.query("ROLLBACK")
    throw new Error(
      `migration ${version} failed: ${err.message}`,
    )
  }
  process.stdout.write(`applied ${version}\n`)
}

/**
 * Incremental migration files, sorted lexically. Names must
 * sort after the baseline (e.g. 0002_add_x.sql).
 */
function migrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return []
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
}

async function migrateLocked(client) {
  await ensureMigrationsTable(client)
  const done = await appliedVersions(client)

  if (!done.has(BASELINE_VERSION)) {
    const sql = fs.readFileSync(SCHEMA_FILE, "utf8")
    await applyVersion(client, BASELINE_VERSION, sql)
  }

  for (const file of migrationFiles()) {
    const version = file.replace(/\.sql$/, "")
    if (done.has(version)) continue
    const sql = fs.readFileSync(
      path.join(MIGRATIONS_DIR, file), "utf8",
    )
    await applyVersion(client, version, sql)
  }
}

async function migrate(client) {
  await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY])
  try {
    await migrateLocked(client)
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY])
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    process.stderr.write("DATABASE_URL is required\n")
    process.exit(1)
  }
  const client = new Client({ connectionString })
  await client.connect()
  try {
    await migrate(client)
    process.stdout.write("migrations up to date\n")
  } finally {
    await client.end()
  }
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${err.message}\n`)
    process.exit(1)
  })
}

module.exports = { migrate, BASELINE_VERSION }
