"use strict"

/**
 * Minimal supabase-js-compatible query builder over node-pg.
 *
 * Implements exactly the subset kaisho-cloud uses so the 19
 * DB call sites keep working unchanged when DB_BACKEND=postgres:
 *
 *   from(t).select(cols)              -> read
 *   from(t).insert(rows).select()     -> insert (+ RETURNING)
 *   from(t).update(obj).eq(...)       -> update
 *   from(t).upsert(row, {onConflict}) -> insert .. on conflict
 *   from(t).delete().eq(...)          -> delete
 *   filters: eq, is(null), in, gt, gte, lt, lte, contains
 *   modifiers: order(col, {ascending}), limit, single, maybeSingle
 *   rpc(name, args)
 *
 * Every terminal awaits to { data, error }, matching supabase-js.
 * jsonb columns are JSON-encoded and cast; text[] columns pass
 * a JS array straight through. Column types are read once from
 * information_schema and cached.
 */

const pg = require("pg")

// Match supabase-js / PostgREST, which return bigint (int8) as
// a JSON number. node-pg defaults to a string, which would turn
// token arithmetic (input_tokens + output_tokens) into string
// concatenation. Token counts stay well within Number's safe
// integer range, same as the Supabase path.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)))

const { Pool } = pg

const NOT_SINGLE = {
  code: "PGRST116",
  message: "JSON object requested, multiple (or no) rows returned",
  details: "Results contain 0 or more than 1 rows",
}

/**
 * Load { table: { cols: {col: {isJson,isArray}}, pk: [col] } }
 * once. The primary key is needed as the default ON CONFLICT
 * target for upsert() calls that pass no onConflict (matching
 * supabase-js, which uses the PK).
 */
async function loadSchema(pool) {
  const cols = await pool.query(
    "SELECT table_name, column_name, data_type" +
    " FROM information_schema.columns" +
    " WHERE table_schema = 'public'",
  )
  const map = {}
  for (const r of cols.rows) {
    const t = map[r.table_name] ||
      (map[r.table_name] = { cols: {}, pk: [] })
    t.cols[r.column_name] = {
      isJson: r.data_type === "jsonb" || r.data_type === "json",
      isArray: r.data_type === "ARRAY",
    }
  }
  const pks = await pool.query(
    "SELECT tc.table_name, kcu.column_name, kcu.ordinal_position" +
    " FROM information_schema.table_constraints tc" +
    " JOIN information_schema.key_column_usage kcu" +
    "   ON tc.constraint_name = kcu.constraint_name" +
    "  AND tc.table_schema = kcu.table_schema" +
    " WHERE tc.constraint_type = 'PRIMARY KEY'" +
    "   AND tc.table_schema = 'public'" +
    " ORDER BY kcu.ordinal_position",
  )
  for (const r of pks.rows) {
    const t = map[r.table_name] ||
      (map[r.table_name] = { cols: {}, pk: [] })
    t.pk.push(r.column_name)
  }
  return map
}

/** Encode one column value for a parameter, with any cast. */
function encode(colType, value) {
  if (
    colType && colType.isJson &&
    value !== null && typeof value === "object"
  ) {
    return { cast: "::jsonb", param: JSON.stringify(value) }
  }
  return { cast: "", param: value }
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`
}

class PgQuery {
  constructor(pool, types, table) {
    this._pool = pool
    this._types = types
    this._table = table
    this._op = null
    this._payload = null
    this._onConflict = null
    this._returning = null
    this._selectCols = "*"
    this._filters = []
    this._orders = []
    this._limit = null
    this._rowMode = null // "single" | "maybe" | null
  }

  _colTypes() {
    const t = this._types[this._table]
    return (t && t.cols) || {}
  }

  _pk() {
    const t = this._types[this._table]
    return (t && t.pk) || []
  }

  select(cols = "*") {
    if (this._op === null) {
      this._op = "select"
      this._selectCols = cols || "*"
    } else {
      this._returning = cols || "*"
    }
    return this
  }

  insert(rows) {
    this._op = "insert"
    this._payload = Array.isArray(rows) ? rows : [rows]
    return this
  }

  update(obj) {
    this._op = "update"
    this._payload = obj
    return this
  }

  upsert(rows, opts = {}) {
    this._op = "upsert"
    this._payload = Array.isArray(rows) ? rows : [rows]
    this._onConflict = opts.onConflict || null
    return this
  }

  delete() {
    this._op = "delete"
    return this
  }

  eq(col, val) {
    this._filters.push({ col, op: "eq", val })
    return this
  }

  is(col, val) {
    // Only IS NULL is used.
    this._filters.push({ col, op: "is", val })
    return this
  }

  in(col, arr) {
    this._filters.push({ col, op: "in", val: arr })
    return this
  }

  gt(col, val) {
    this._filters.push({ col, op: "gt", val })
    return this
  }

  gte(col, val) {
    this._filters.push({ col, op: "gte", val })
    return this
  }

  lt(col, val) {
    this._filters.push({ col, op: "lt", val })
    return this
  }

  lte(col, val) {
    this._filters.push({ col, op: "lte", val })
    return this
  }

  contains(col, val) {
    this._filters.push({ col, op: "contains", val })
    return this
  }

  order(col, opts = {}) {
    this._orders.push({
      col,
      ascending: opts.ascending !== false,
      nullsFirst: opts.nullsFirst,
    })
    return this
  }

  limit(n) {
    this._limit = n
    return this
  }

  single() {
    this._rowMode = "single"
    return this
  }

  maybeSingle() {
    this._rowMode = "maybe"
    return this
  }

  _where(params) {
    if (this._filters.length === 0) return ""
    const parts = this._filters.map((f) => {
      const id = quoteIdent(f.col)
      if (f.op === "is") return `${id} IS NULL`
      if (f.op === "in") {
        params.push(f.val)
        return `${id} = ANY($${params.length})`
      }
      if (f.op === "contains") {
        params.push(f.val)
        return `${id} @> $${params.length}`
      }
      const sqlOp = {
        eq: "=", gt: ">", gte: ">=", lt: "<", lte: "<=",
      }[f.op]
      params.push(f.val)
      return `${id} ${sqlOp} $${params.length}`
    })
    return " WHERE " + parts.join(" AND ")
  }

  _orderBy() {
    if (this._orders.length === 0) return ""
    const parts = this._orders.map((o) => {
      const dir = o.ascending ? "ASC" : "DESC"
      let s = `${quoteIdent(o.col)} ${dir}`
      if (o.nullsFirst === true) s += " NULLS FIRST"
      if (o.nullsFirst === false) s += " NULLS LAST"
      return s
    })
    return " ORDER BY " + parts.join(", ")
  }

  _returningClause() {
    if (this._returning === null) return ""
    if (this._returning === "*" || !this._returning) {
      return " RETURNING *"
    }
    const cols = this._returning
      .split(",")
      .map((c) => quoteIdent(c.trim()))
      .join(", ")
    return ` RETURNING ${cols}`
  }

  _buildInsertLike(params, verb) {
    const types = this._colTypes()
    const cols = Object.keys(this._payload[0])
    const colSql = cols.map(quoteIdent).join(", ")
    const rowsSql = this._payload.map((row) => {
      const cells = cols.map((c) => {
        const { cast, param } = encode(types[c], row[c])
        params.push(param)
        return `$${params.length}${cast}`
      })
      return `(${cells.join(", ")})`
    })
    let sql =
      `INSERT INTO ${quoteIdent(this._table)} (${colSql})` +
      ` VALUES ${rowsSql.join(", ")}`
    if (verb === "upsert") {
      // Explicit onConflict, else the table's primary key
      // (supabase-js default). Update every non-conflict column.
      const target = this._onConflict
        ? this._onConflict.split(",").map((c) => c.trim())
        : this._pk()
      const conflictCols = target.map(quoteIdent)
      const setCols = cols
        .filter((c) => !target.includes(c))
        .map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`)
      sql += ` ON CONFLICT (${conflictCols.join(", ")}) DO`
      sql += setCols.length
        ? ` UPDATE SET ${setCols.join(", ")}`
        : " NOTHING"
    }
    return sql + this._returningClause()
  }

  _buildUpdate(params) {
    const types = this._colTypes()
    const cols = Object.keys(this._payload)
    const sets = cols.map((c) => {
      const { cast, param } = encode(types[c], this._payload[c])
      params.push(param)
      return `${quoteIdent(c)} = $${params.length}${cast}`
    })
    return (
      `UPDATE ${quoteIdent(this._table)} SET ${sets.join(", ")}` +
      this._where(params) + this._returningClause()
    )
  }

  _build() {
    const params = []
    let sql
    let wantsRows
    if (this._op === "select" || this._op === null) {
      sql =
        `SELECT ${this._selectCols === "*" ? "*" : this._selectCols}` +
        ` FROM ${quoteIdent(this._table)}` +
        this._where(params) + this._orderBy() +
        (this._limit != null ? ` LIMIT ${Number(this._limit)}` : "")
      wantsRows = true
    } else if (this._op === "insert") {
      sql = this._buildInsertLike(params, "insert")
      wantsRows = this._returning !== null
    } else if (this._op === "upsert") {
      sql = this._buildInsertLike(params, "upsert")
      wantsRows = this._returning !== null
    } else if (this._op === "update") {
      sql = this._buildUpdate(params)
      wantsRows = this._returning !== null
    } else if (this._op === "delete") {
      sql =
        `DELETE FROM ${quoteIdent(this._table)}` +
        this._where(params) + this._returningClause()
      wantsRows = this._returning !== null
    } else {
      throw new Error(`unsupported op: ${this._op}`)
    }
    return { sql, params, wantsRows }
  }

  _shape(rows, wantsRows) {
    if (!wantsRows) return { data: null, error: null }
    if (this._rowMode === "single") {
      if (rows.length === 1) return { data: rows[0], error: null }
      return { data: null, error: { ...NOT_SINGLE } }
    }
    if (this._rowMode === "maybe") {
      if (rows.length <= 1) {
        return { data: rows[0] || null, error: null }
      }
      return { data: null, error: { ...NOT_SINGLE } }
    }
    return { data: rows, error: null }
  }

  async _execute() {
    try {
      if (this._types.__pending) {
        this._types = await this._types.__pending
      }
      const { sql, params, wantsRows } = this._build()
      const res = await this._pool.query(sql, params)
      return this._shape(res.rows, wantsRows)
    } catch (err) {
      return {
        data: null,
        error: { message: err.message, code: err.code || null },
      }
    }
  }

  then(onFulfilled, onRejected) {
    return this._execute().then(onFulfilled, onRejected)
  }

  catch(onRejected) {
    return this._execute().catch(onRejected)
  }
}

class PgClient {
  constructor(pool) {
    this._pool = pool
    // Types load lazily; the first query awaits this promise and
    // then every PgQuery shares the resolved map.
    this._types = { __pending: null }
    this._typesPromise = null
  }

  _ensureTypes() {
    if (!this._typesPromise) {
      this._typesPromise = loadSchema(this._pool)
    }
    return this._typesPromise
  }

  from(table) {
    const types = { __pending: this._ensureTypes() }
    return new PgQuery(this._pool, types, table)
  }

  async rpc(name, args = {}) {
    try {
      const keys = Object.keys(args)
      const params = keys.map((k) => args[k])
      const named = keys
        .map((k, i) => `${quoteIdent(k)} => $${i + 1}`)
        .join(", ")
      const sql = `SELECT ${quoteIdent(name)}(${named}) AS result`
      const res = await this._pool.query(sql, params)
      const value = res.rows.length ? res.rows[0].result : null
      return { data: value, error: null }
    } catch (err) {
      return {
        data: null,
        error: { message: err.message, code: err.code || null },
      }
    }
  }

  // Escape hatch for queries the builder can't express (joins,
  // aggregates). Postgres backend only; used by admin stats.
  // Returns { rows } or throws.
  async raw(text, params = []) {
    return this._pool.query(text, params)
  }
}

function createClient(connectionString) {
  const url = connectionString || process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is required")
  const pool = new Pool({ connectionString: url })
  return new PgClient(pool)
}

module.exports = { createClient, PgClient, PgQuery }
