-- Kaisho Cloud — bidirectional sync schema
--
-- Drops the old push/pull "synced" semantics in favour of
-- a symmetric last-writer-wins protocol keyed on `id`.
-- Adds soft-delete (deleted_at), unifies on `invoiced`
-- (drops `booked`), and indexes updated_at for pulls.

-- ── Clock entries: structural changes ───────────────────

ALTER TABLE clock_entries
    ADD COLUMN invoiced   BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN deleted_at TIMESTAMPTZ;

-- Preserve any existing `booked=true` as `invoiced=true`.
UPDATE clock_entries SET invoiced = true WHERE booked = true;

ALTER TABLE clock_entries
    DROP COLUMN booked,
    DROP COLUMN synced,
    DROP COLUMN synced_at;

-- ── Indexes ─────────────────────────────────────────────

DROP INDEX IF EXISTS idx_clock_user_synced;

CREATE INDEX idx_clock_user_updated
    ON clock_entries(user_id, updated_at);

CREATE INDEX idx_clock_user_deleted
    ON clock_entries(user_id, deleted_at)
    WHERE deleted_at IS NOT NULL;

-- Active-timer uniqueness must ignore soft-deleted rows.
DROP INDEX IF EXISTS idx_one_active;
CREATE UNIQUE INDEX idx_one_active
    ON clock_entries(user_id)
    WHERE end_at IS NULL AND deleted_at IS NULL;
