-- Inbox entries for cloud sync.
-- Mirrors the local inbox.org structure with sync identity.

CREATE TABLE IF NOT EXISTS inbox_entries (
    id          UUID PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES auth.users(id)
                ON DELETE CASCADE,
    type        TEXT NOT NULL DEFAULT 'NOTE',
    customer    TEXT NOT NULL DEFAULT '',
    title       TEXT NOT NULL,
    body        TEXT NOT NULL DEFAULT '',
    channel     TEXT NOT NULL DEFAULT '',
    direction   TEXT NOT NULL DEFAULT 'in',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ,
    synced_at   TIMESTAMPTZ
);

CREATE INDEX idx_inbox_user_updated
    ON inbox_entries (user_id, updated_at);

CREATE INDEX idx_inbox_user_deleted
    ON inbox_entries (user_id, deleted_at)
    WHERE deleted_at IS NOT NULL;
