"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")

const { Client } = require("pg")
const { migrate } = require("../db/migrate")
const { createClient } = require("../api/db_pg")

// Parity tests for the pg query shim against real Postgres.
// Set TEST_DATABASE_URL to a disposable database; skipped
// otherwise so CI stays green without Postgres.
const url = process.env.TEST_DATABASE_URL
const opts = { skip: url ? false : "set TEST_DATABASE_URL to run" }

async function freshUser(db, suffix) {
  const { data, error } = await db
    .from("users")
    .insert({ email: `u${suffix}@x.com`, api_key_hash: "h" })
    .select()
    .single()
  assert.equal(error, null)
  return data.id
}

test("pg shim: insert/select/single + filters", opts, async () => {
  const setup = new Client({ connectionString: url })
  await setup.connect()
  await migrate(setup)
  await setup.end()

  const db = createClient(url)
  const uid = await freshUser(db, "a" + Date.now())

  // insert returning single
  const ins = await db
    .from("clock_entries")
    .insert({ user_id: uid, start_at: new Date().toISOString() })
    .select()
    .single()
  assert.equal(ins.error, null)
  assert.equal(ins.data.user_id, uid)
  assert.equal(ins.data.invoiced, false)

  // second, ended entry so filters have variety
  await db.from("clock_entries").insert({
    user_id: uid,
    start_at: new Date(Date.now() - 1000).toISOString(),
    end_at: new Date().toISOString(),
  })

  // eq + is(null): only the still-running timer
  const running = await db
    .from("clock_entries")
    .select()
    .eq("user_id", uid)
    .is("end_at", null)
  assert.equal(running.error, null)
  assert.equal(running.data.length, 1)

  // order + limit
  const ordered = await db
    .from("clock_entries")
    .select()
    .eq("user_id", uid)
    .order("start_at", { ascending: false })
    .limit(1)
  assert.equal(ordered.data.length, 1)
  assert.equal(ordered.data[0].id, ins.data.id)

  // in() on a uuid id column
  const byIds = await db
    .from("clock_entries")
    .select()
    .in("id", [ins.data.id])
  assert.equal(byIds.data.length, 1)
})

test("pg shim: update + delete with returning", opts, async () => {
  const db = createClient(url)
  const uid = await freshUser(db, "b" + Date.now())

  await db.from("tasks").insert({
    id: "T-1", user_id: uid, title: "one", tags: ["x", "y"],
  })

  const upd = await db
    .from("tasks")
    .update({ title: "two" })
    .eq("user_id", uid)
    .eq("id", "T-1")
    .select()
    .single()
  assert.equal(upd.error, null)
  assert.equal(upd.data.title, "two")

  // contains on a text[] column
  const tagged = await db
    .from("tasks")
    .select()
    .eq("user_id", uid)
    .contains("tags", ["x"])
  assert.equal(tagged.data.length, 1)

  // update without select returns null data
  const noSel = await db
    .from("tasks")
    .update({ status: "DONE" })
    .eq("user_id", uid)
  assert.deepEqual(noSel, { data: null, error: null })

  // delete + returning
  const del = await db
    .from("tasks")
    .delete()
    .eq("user_id", uid)
    .select()
  assert.equal(del.data.length, 1)
})

test("pg shim: upsert (onConflict + PK default + jsonb)", opts,
  async () => {
    const db = createClient(url)
    const uid = await freshUser(db, "c" + Date.now())

    // explicit onConflict, jsonb column
    const first = await db
      .from("ref_config")
      .upsert(
        { user_id: uid, config: { a: 1 } },
        { onConflict: "user_id" },
      )
      .select()
      .single()
    assert.equal(first.error, null)
    assert.deepEqual(first.data.config, { a: 1 })

    const second = await db
      .from("ref_config")
      .upsert(
        { user_id: uid, config: { a: 2, b: 3 } },
        { onConflict: "user_id" },
      )
      .select()
      .single()
    assert.deepEqual(second.data.config, { a: 2, b: 3 })

    // upsert WITHOUT onConflict -> PK default, must UPDATE
    await db.from("cron_health").upsert({
      id: 1, reconcile_count: 7,
    })
    await db.from("cron_health").upsert({
      id: 1, reconcile_count: 9,
    })
    const health = await db
      .from("cron_health").select().eq("id", 1).single()
    assert.equal(health.data.reconcile_count, 9)

    // jsonb array column (projects.milestones)
    const proj = await db
      .from("projects")
      .insert({
        id: "P-1", user_id: uid, name: "p",
        milestones: [{ id: "M-1" }], tags: ["t"],
      })
      .select()
      .single()
    assert.equal(proj.error, null)
    assert.deepEqual(proj.data.milestones, [{ id: "M-1" }])
    assert.deepEqual(proj.data.tags, ["t"])
  })

test("pg shim: single/maybeSingle semantics", opts, async () => {
  const db = createClient(url)
  const uid = await freshUser(db, "d" + Date.now())

  // maybeSingle with 0 rows -> data null, no error
  const none = await db
    .from("tasks").select().eq("user_id", uid)
    .eq("id", "nope").maybeSingle()
  assert.deepEqual(none, { data: null, error: null })

  // single with 0 rows -> PGRST116 error
  const err = await db
    .from("tasks").select().eq("user_id", uid)
    .eq("id", "nope").single()
  assert.equal(err.data, null)
  assert.equal(err.error.code, "PGRST116")
})

test("pg shim: rpc functions", opts, async () => {
  const db = createClient(url)
  const uid = await freshUser(db, "e" + Date.now())

  await db.rpc("increment_ai_usage", {
    p_user_id: uid, p_month: "2026-07", p_input: 10, p_output: 5,
  })
  const bumped = await db.rpc("increment_ai_usage", {
    p_user_id: uid, p_month: "2026-07", p_input: 20, p_output: 5,
  })
  assert.equal(bumped.error, null)

  const usage = await db
    .from("ai_usage").select()
    .eq("user_id", uid).eq("month", "2026-07").single()
  assert.equal(Number(usage.data.input_tokens), 30)

  const found = await db.rpc("find_user_id_by_email", {
    p_email: (await db.from("users").select("email")
      .eq("id", uid).single()).data.email,
  })
  assert.equal(found.data, uid)

  const wiped = await db.rpc("wipe_user_sync_state", {
    p_user_id: uid,
  })
  assert.equal(typeof Number(wiped.data), "number")
})

test("pg shim: counts", opts, async () => {
  const db = createClient(url)
  const uid = await freshUser(db, "f" + Date.now())
  const t = new Date().toISOString()

  // end_at on every row: idx_one_active is a unique index
  // over (user_id) WHERE end_at IS NULL, so a second
  // running timer would be rejected, not counted.
  for (let i = 0; i < 3; i++) {
    const r = await db.from("clock_entries")
      .insert({ user_id: uid, start_at: t, end_at: t })
    assert.equal(r.error, null)
  }
  const gone = await db.from("clock_entries").insert({
    user_id: uid, start_at: t, end_at: t, deleted_at: t,
  })
  assert.equal(gone.error, null)

  // head count: the number, no rows. This is the call
  // /sync/stats makes; it used to come back undefined and
  // surface to the client as entry_count 0.
  const live = await db
    .from("clock_entries")
    .select("id", { count: "exact", head: true })
    .eq("user_id", uid)
    .is("deleted_at", null)
  assert.equal(live.count, 3)
  assert.equal(live.data, null)
  assert.equal(live.error, null)

  // no matches is 0, not undefined
  const empty = await db
    .from("clock_entries")
    .select("id", { count: "exact", head: true })
    .eq("user_id", uid)
    .eq("description", "nothing matches this")
  assert.equal(empty.count, 0)

  // an update reports the rows it touched, which is what
  // /sync/ack answers with
  const upd = await db
    .from("clock_entries")
    .update({ notes: "n" }, { count: "exact" })
    .eq("user_id", uid)
    .is("deleted_at", null)
  assert.equal(upd.count, 3)
  assert.equal(upd.error, null)

  const noop = await db
    .from("clock_entries")
    .update({ notes: "n" }, { count: "exact" })
    .eq("user_id", uid)
    .eq("description", "nothing matches this")
  assert.equal(noop.count, 0)

  const del = await db
    .from("clock_entries")
    .delete({ count: "exact" })
    .eq("user_id", uid)
  assert.equal(del.count, 4)

  // a write that was not asked for a count does not grow
  // one: the other call sites deepEqual their result
  const plain = await db
    .from("clock_entries").delete().eq("user_id", uid)
  assert.deepEqual(plain, { data: null, error: null })

  // the rows-plus-total form is not implemented, and says so
  assert.throws(
    () => db.from("clock_entries").select("*", { count: "exact" }),
    /head:true/,
  )
})
