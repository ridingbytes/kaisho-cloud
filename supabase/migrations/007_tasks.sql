-- Full tasks table for bidirectional sync.
-- Replaces the read-only ref_tasks snapshot.

CREATE TABLE IF NOT EXISTS tasks (
    id          TEXT NOT NULL,
    user_id     UUID NOT NULL REFERENCES auth.users(id)
                ON DELETE CASCADE,
    customer    TEXT NOT NULL DEFAULT '',
    title       TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'TODO',
    tags        TEXT[] NOT NULL DEFAULT '{}',
    body        TEXT NOT NULL DEFAULT '',
    github_url  TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ,
    synced_at   TIMESTAMPTZ,
    PRIMARY KEY (user_id, id)
);

CREATE INDEX idx_tasks_user_updated
    ON tasks (user_id, updated_at);
