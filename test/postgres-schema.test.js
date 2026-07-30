"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")

const { migrate, BASELINE_VERSION } = require("../db/migrate")

// Integration test against a real Postgres. Set
// TEST_DATABASE_URL to a disposable, empty database to run
// it; skipped otherwise so CI stays green without Postgres.
//   createdb kaisho_test
//   TEST_DATABASE_URL=postgres://localhost/kaisho_test \
//     npm test
const url = process.env.TEST_DATABASE_URL

test("schema applies and is idempotent", {
  skip: url ? false : "set TEST_DATABASE_URL to run",
}, async () => {
  const { Client } = require("pg")
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    await migrate(client)
    await migrate(client) // second run is a no-op

    const versions = await client.query(
      "SELECT version FROM schema_migrations",
    )
    assert.deepEqual(
      versions.rows.map((r) => r.version),
      [BASELINE_VERSION],
    )

    const tables = await client.query(
      "SELECT count(*)::int AS n FROM information_schema.tables" +
      " WHERE table_schema = 'public'" +
      " AND table_type = 'BASE TABLE'",
    )
    // 15 domain tables + schema_migrations.
    assert.equal(tables.rows[0].n, 16)

    const uid = await client.query(
      "INSERT INTO users (email, api_key_hash)" +
      " VALUES ('t@example.com', 'h') RETURNING id",
    )
    const id = uid.rows[0].id
    await client.query(
      "SELECT increment_ai_usage($1, '2026-07', 10, 5)", [id],
    )
    await client.query(
      "SELECT increment_ai_usage($1, '2026-07', 20, 5)", [id],
    )
    const usage = await client.query(
      "SELECT input_tokens, request_count FROM ai_usage" +
      " WHERE user_id = $1 AND month = '2026-07'", [id],
    )
    assert.equal(Number(usage.rows[0].input_tokens), 30)
    assert.equal(usage.rows[0].request_count, 2)
  } finally {
    await client.end()
  }
})
