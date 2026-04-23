-- Notes table for bidirectional sync.

CREATE TABLE IF NOT EXISTS notes (
    id          TEXT NOT NULL,
    user_id     UUID NOT NULL REFERENCES auth.users(id)
                ON DELETE CASCADE,
    customer    TEXT NOT NULL DEFAULT '',
    title       TEXT NOT NULL,
    body        TEXT NOT NULL DEFAULT '',
    tags        TEXT[] NOT NULL DEFAULT '{}',
    task_id     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ,
    synced_at   TIMESTAMPTZ,
    PRIMARY KEY (user_id, id)
);

CREATE INDEX idx_notes_user_updated
    ON notes (user_id, updated_at);

CREATE INDEX idx_notes_deleted
    ON notes (user_id, deleted_at)
    WHERE deleted_at IS NOT NULL;
