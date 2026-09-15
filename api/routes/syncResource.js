"use strict"

/**
 * @module routes/syncResource
 *
 * Mounts the three standard sync handlers --
 * ``GET /changes``, ``POST /apply``, ``POST /ack`` --
 * for one resource (clock entries, inbox items, tasks,
 * notes). Every CRUD-shape resource in this codebase
 * speaks the same wire protocol, so the only thing
 * that varies across them is the table name, the
 * row<->wire mapping, the apply-field allowlist, the
 * apply validation schema, and the broadcast event
 * name. Everything else (paging, last-writer-wins
 * conflict resolution, batched insert with per-row
 * retry on conflict, ack semantics) is identical.
 *
 * Before this module the same ~150 lines were
 * duplicated four times in routes/sync.js, leading to
 * subtle drift (clock_entries' existing-row SELECT
 * included ``deleted_at`` that nothing used; the
 * clock-only /ack had an error branch the other three
 * did not). Routing through this factory makes the
 * resources textually identical.
 *
 * The deps the factory needs are injected so this
 * module stays free of imports beyond its
 * dependencies; the caller in routes/sync.js wires
 * db / broadcast / decideMerge / insertWith
 * RowRetry / validation / middleware once and passes
 * the bundle to each mount call.
 */


/**
 * Mount the three standard sync handlers on the
 * router under ``opts.pathPrefix``.
 *
 * @param {import("express").Router} router
 * @param {object} opts
 * @param {string} opts.table       DB table name.
 * @param {string} opts.pathPrefix  '' (clock entries
 *   keep the bare /changes /apply /ack paths) or
 *   '/inbox' / '/tasks' / '/notes' for the others.
 * @param {string[]} opts.applyFields Allowlisted
 *   column names included in update payloads.
 * @param {object} opts.applySchema  Validation schema
 *   passed to ``validate()``.
 * @param {function} opts.rowToWire  Map a DB row to
 *   the wire-format entry the client receives.
 * @param {function} opts.wireToRow  Map a wire entry
 *   to a row ready for insert/update. Takes ``(entry,
 *   userId)``.
 * @param {string} opts.broadcastEvent Event name
 *   pushed over the WS broadcaster after a successful
 *   apply (e.g. "entries:changed", "tasks:changed").
 * @param {object} deps Shared singletons / helpers --
 *   pulled in by the caller to avoid this module
 *   re-importing them. Required:
 *   ``db``, ``broadcast``, ``decideMerge``,
 *   ``insertWithRowRetry``, ``validate``,
 *   ``validateQuery``, ``syncChangesQuerySchema``,
 *   ``requireAuth``, ``requireSync``, ``asyncHandler``.
 */
function mountSyncResource(router, opts, deps) {
  _mountChanges(router, opts, deps)
  _mountApply(router, opts, deps)
  _mountAck(router, opts, deps)
}


function _mountChanges(router, opts, deps) {
  const {
    table, pathPrefix, rowToWire,
  } = opts
  const {
    db, validateQuery,
    syncChangesQuerySchema,
    requireAuth, requireSync, asyncHandler,
  } = deps
  router.get(
    `${pathPrefix}/changes`,
    requireAuth,
    requireSync,
    validateQuery(syncChangesQuerySchema),
    asyncHandler(async (req, res) => {
      const since =
        req.query.since || "1970-01-01T00:00:00Z"
      const limit = Math.min(
        parseInt(req.query.limit) || 200, 500,
      )
      const page = await _readPage(
        db, table, req.userId, since, limit,
      )
      if (page.error) {
        req.log?.error?.(
          { err: page.error, since, limit, table },
          "sync changes query failed",
        )
        return res.status(500).json({
          error: `Failed to fetch ${table} changes`,
        })
      }
      const { rows, hasMore } = page
      const cursor =
        rows.length > 0
          ? rows[rows.length - 1].updated_at
          : since
      res.json({
        now: new Date().toISOString(),
        cursor,
        entries: rows.map(rowToWire),
        has_more: hasMore,
      })
    }),
  )
}


/**
 * Read one page of changes after ``since``.
 *
 * The cursor is a bare timestamp, and the next pull asks
 * for ``updated_at > cursor``. That is only safe if the
 * page ends on a timestamp boundary. It did not: a page
 * that filled up mid-timestamp reported the shared value
 * as the cursor, and every remaining row carrying it was
 * then excluded by the ``>`` on the following request.
 * Those rows were never delivered again.
 *
 * Rows can share a timestamp in ordinary use. The desktop
 * backfills ``updated_at`` from an entry's ``created``
 * date for rows that predate cloud sync, so a bulk import
 * can leave hundreds of notes stamped with the same day.
 *
 * So: trim the trailing rows that share the last
 * timestamp, and let them arrive on the next pull with a
 * cursor that sits cleanly below them. When the whole page
 * shares one timestamp there is nothing to trim without
 * emptying it, so read that timestamp in full instead --
 * one extra query, and only in the case that would
 * otherwise lose data.
 *
 * @returns {Promise<{rows: object[], hasMore: boolean,
 *   error?: object}>}
 */
/**
 * Compare two updated_at values. The data layer hands back
 * Date objects for timestamptz columns, and === on two
 * Dates compares references, so every row would look
 * distinct and the trim below would never fire.
 */
function _sameStamp(a, b) {
  return String(a instanceof Date ? a.toISOString() : a)
    === String(b instanceof Date ? b.toISOString() : b)
}

async function _readPage(db, table, userId, since, limit) {
  const { data: rows, error } = await db
    .from(table)
    .select("*")
    .eq("user_id", userId)
    .gt("updated_at", since)
    .order("updated_at", { ascending: true })
    .limit(limit)
  if (error) return { error }
  if (rows.length < limit) {
    return { rows, hasMore: false }
  }

  const last = rows[rows.length - 1].updated_at
  if (!_sameStamp(rows[0].updated_at, last)) {
    const trimmed = rows.filter(
      (r) => !_sameStamp(r.updated_at, last),
    )
    return { rows: trimmed, hasMore: true }
  }

  const { data: all, error: allErr } = await db
    .from(table)
    .select("*")
    .eq("user_id", userId)
    .eq("updated_at", last)
    .order("id", { ascending: true })
  if (allErr) return { error: allErr }
  return { rows: all, hasMore: true }
}

function _mountApply(router, opts, deps) {
  const {
    table, pathPrefix, applyFields, applySchema,
    wireToRow, broadcastEvent,
  } = opts
  const {
    db, broadcast,
    decideMerge, insertWithRowRetry,
    validate, requireAuth, requireSync, asyncHandler,
  } = deps
  router.post(
    `${pathPrefix}/apply`,
    requireAuth,
    requireSync,
    validate(applySchema),
    asyncHandler(async (req, res) => {
      const { entries } = req.body
      const counts = {
        inserted: 0, updated: 0,
        skipped: 0, errors: 0,
      }
      const errorIds = []

      const ids = entries.map((e) => e.id)
      const { data: existingRows } = await db
        .from(table)
        .select("id, updated_at")
        .eq("user_id", req.userId)
        .in("id", ids)
      const existingMap = new Map(
        (existingRows || []).map((r) => [r.id, r]),
      )

      const toInsert = []
      const toUpdate = []
      for (const entry of entries) {
        const existing =
          existingMap.get(entry.id) || null
        const decision = decideMerge(existing, entry)
        if (decision.action === "skip") {
          counts.skipped++
        } else if (decision.action === "insert") {
          toInsert.push(wireToRow(entry, req.userId))
          counts.inserted++
        } else {
          const row = wireToRow(entry, req.userId)
          const updates = {}
          for (const k of applyFields) {
            updates[k] = row[k]
          }
          updates.deleted_at = row.deleted_at
          updates.updated_at = row.updated_at
          updates.id = entry.id
          toUpdate.push(updates)
          counts.updated++
        }
      }

      const insertFails = await insertWithRowRetry(
        table, toInsert,
      )
      if (insertFails.length > 0) {
        counts.errors += insertFails.length
        counts.inserted -= insertFails.length
        errorIds.push(...insertFails)
      }

      if (toUpdate.length > 0) {
        for (const row of toUpdate) {
          const { error } = await db
            .from(table)
            .update(row)
            .eq("id", row.id)
            .eq("user_id", req.userId)
          if (error) {
            counts.errors++
            counts.updated--
            errorIds.push(row.id)
          }
        }
      }

      const applied = counts.inserted + counts.updated
      // Respond first, broadcast after -- the desktop
      // sync caller gets its response without waiting
      // for every WS subscriber.
      res.json({
        ...counts,
        errors: errorIds,
        applied_at: new Date().toISOString(),
      })
      if (applied > 0) {
        process.nextTick(() => {
          broadcast(req.userId, broadcastEvent, {
            count: applied,
          })
        })
      }
    }),
  )
}


function _mountAck(router, opts, deps) {
  const { table, pathPrefix } = opts
  const {
    db, requireAuth, requireSync, asyncHandler,
  } = deps
  router.post(
    `${pathPrefix}/ack`,
    requireAuth,
    requireSync,
    asyncHandler(async (req, res) => {
      const { ids } = req.body
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({
          error: "ids must be a non-empty array",
        })
      }
      if (
        !ids.every((id) => typeof id === "string")
      ) {
        return res.status(400).json({
          error: "ids must contain only strings",
        })
      }
      const now = new Date().toISOString()
      // count:"exact" is what makes the data layer report
      // the affected rows. Without it `count` is absent,
      // and the old `?? ids.length` fallback then told the
      // client every id it sent was acked -- including ids
      // that had no row, or a row already acked.
      const { error, count } = await db
        .from(table)
        .update({ synced_at: now }, { count: "exact" })
        .eq("user_id", req.userId)
        .in("id", ids.slice(0, 500))
        .is("synced_at", null)
      if (error) {
        return res
          .status(500)
          .json({ error: "Failed to ack" })
      }
      // No ?? ids.length fallback: the data layer now
      // reports the affected rows, and guessing the
      // request size instead told a client that ids it
      // never had rows for were acked.
      res.json({ acked: count })
    }),
  )
}


module.exports = { mountSyncResource }
