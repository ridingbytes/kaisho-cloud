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
 * supabase / broadcast / decideMerge / insertWith
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
 *   ``supabase``, ``broadcast``, ``decideMerge``,
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
    supabase, validateQuery,
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
      const { data: rows, error } = await supabase
        .from(table)
        .select("*")
        .eq("user_id", req.userId)
        .gt("updated_at", since)
        .order("updated_at", { ascending: true })
        .limit(limit)
      if (error) {
        req.log?.error?.(
          { err: error, since, limit, table },
          "sync changes query failed",
        )
        return res.status(500).json({
          error: `Failed to fetch ${table} changes`,
        })
      }
      const cursor =
        rows.length > 0
          ? rows[rows.length - 1].updated_at
          : since
      res.json({
        now: new Date().toISOString(),
        cursor,
        entries: rows.map(rowToWire),
        has_more: rows.length === limit,
      })
    }),
  )
}


function _mountApply(router, opts, deps) {
  const {
    table, pathPrefix, applyFields, applySchema,
    wireToRow, broadcastEvent,
  } = opts
  const {
    supabase, broadcast,
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
      const { data: existingRows } = await supabase
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
          const { error } = await supabase
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
    supabase, requireAuth, requireSync, asyncHandler,
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
      const { error, count } = await supabase
        .from(table)
        .update({ synced_at: now })
        .eq("user_id", req.userId)
        .in("id", ids.slice(0, 500))
        .is("synced_at", null)
      if (error) {
        return res
          .status(500)
          .json({ error: "Failed to ack" })
      }
      res.json({ acked: count ?? ids.length })
    }),
  )
}


module.exports = { mountSyncResource }
