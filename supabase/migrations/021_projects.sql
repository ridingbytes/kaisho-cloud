-- First-class Projects for bidirectional sync.
--
-- Projects are the connective tissue between customers,
-- tasks, notes, and clock entries in the desktop app
-- (kaisho 2.7). The desktop already pushes the `project`
-- (and `milestone`) foreign keys on every task, note, and
-- clock entry it syncs — the cloud silently dropped them
-- until now. This migration adds:
--
--   1. A `projects` table mirroring the desktop project
--      dict (org-mode `projects.org` is the desktop's
--      source of truth; the cloud is a queryable mirror).
--   2. The `project` / `milestone` reference columns on
--      the tasks, notes, and clock_entries tables.
--
-- Milestones are stored inline as a JSONB array on the
-- project row rather than a child table: they are always
-- fetched and written with their parent project, they are
-- small, and this keeps the sync protocol single-table
-- per resource (same shape as tags on tasks).
--
-- Dates (`start_date`, `due_date`) are plain YYYY-MM-DD
-- TEXT, matching the org-mode serialization, to avoid any
-- timezone drift on a value that has no time component.

CREATE TABLE IF NOT EXISTS projects (
    id          TEXT NOT NULL,
    user_id     UUID NOT NULL REFERENCES auth.users(id)
                ON DELETE CASCADE,
    name        TEXT NOT NULL,
    customer    TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'ACTIVE',
    contract    TEXT,
    start_date  TEXT,
    due_date    TEXT,
    color       TEXT NOT NULL DEFAULT '',
    tags        TEXT[] NOT NULL DEFAULT '{}',
    description TEXT NOT NULL DEFAULT '',
    milestones  JSONB NOT NULL DEFAULT '[]',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ,
    synced_at   TIMESTAMPTZ,
    PRIMARY KEY (user_id, id)
);

CREATE INDEX idx_projects_user_updated
    ON projects (user_id, updated_at);

CREATE INDEX idx_projects_deleted
    ON projects (user_id, deleted_at)
    WHERE deleted_at IS NOT NULL;

-- Reference columns. No hard FK constraint: project IDs
-- are opaque strings and a task may legitimately reference
-- a project that was deleted (it keeps the id but stops
-- resolving), exactly as the desktop SQL backend behaves.

ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS project   TEXT,
    ADD COLUMN IF NOT EXISTS milestone TEXT;

ALTER TABLE notes
    ADD COLUMN IF NOT EXISTS project TEXT;

ALTER TABLE clock_entries
    ADD COLUMN IF NOT EXISTS project TEXT;
