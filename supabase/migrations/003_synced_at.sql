-- Re-add synced_at so the mobile UI can show whether the
-- local app has pulled an entry. Stamped by POST /sync/ack.

ALTER TABLE clock_entries
    ADD COLUMN synced_at TIMESTAMPTZ;
