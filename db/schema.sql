-- Kaisho Cloud — consolidated schema (vanilla PostgreSQL 16)
--
-- Final state after migrations 001–024, with all
-- Supabase-specific constructs removed:
--   * users.id no longer REFERENCES auth.users; it is a
--     self-owned uuid primary key (gen_random_uuid()).
--   * All ROW LEVEL SECURITY / CREATE POLICY removed
--     (service-role-only access, RLS unused on plain PG).
--   * All REVOKE / GRANT to anon/authenticated/service_role
--     removed (those roles do not exist here).
--   * SECURITY DEFINER + auth-schema dependencies dropped
--     from the RPC functions.
--   * find_user_id_by_email now reads the new users.email
--     column instead of auth.users.
-- Two additive columns (email, password_hash) prepare users
-- for a future self-owned auth system.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────
-- Tables (FK dependency order: users first)
-- ─────────────────────────────────────────────────────────

-- ── users ────────────────────────────────────────────────
-- Account + API key + AI overrides. email / password_hash /
-- disabled_at power the self-owned auth and admin provisioning.
-- (plan is vestigial: always 'free'; no paid plans.)

CREATE TABLE users (
    id                     UUID PRIMARY KEY
                           DEFAULT gen_random_uuid(),
    api_key_hash           TEXT,
    -- Vestigial: there are no paid plans. Always 'free'.
    -- Kept until desktop/mobile clients drop the field.
    plan                   TEXT NOT NULL DEFAULT 'free',
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_key_prefix         TEXT,
    monthly_token_cap_override INT NULL,
    advisor_model_override TEXT NULL,
    cron_model_override    TEXT NULL,
    -- Self-owned auth: email + bcrypt password hash.
    email                  TEXT UNIQUE,
    password_hash          TEXT,
    -- Set by the admin provisioning API to revoke access
    -- (e.g. subscription cancelled). NULL = active.
    disabled_at            TIMESTAMPTZ,
    CONSTRAINT users_token_cap_override_range
        CHECK (
            monthly_token_cap_override IS NULL
            OR (
                monthly_token_cap_override >= 0
                AND monthly_token_cap_override <= 10000000
            )
        )
);

COMMENT ON COLUMN users.monthly_token_cap_override IS
    'Per-user override for monthly AI token cap. NULL = '
    'use gateway_config.monthly_token_cap. Set higher to '
    'grant extended usage; set to 0 to suspend AI access.';
COMMENT ON COLUMN users.advisor_model_override IS
    'Per-user override for the advisor model. NULL = '
    'use gateway_config.model_advisor. Use to A/B test '
    'a different model with a single user.';
COMMENT ON COLUMN users.cron_model_override IS
    'Per-user override for the cron model. NULL = '
    'use gateway_config.model_cron.';

-- ── clock_entries ────────────────────────────────────────
-- 001 base; 002 dropped booked/synced/synced_at, added
-- invoiced/deleted_at; 003 re-added synced_at; 021 project.

CREATE TABLE clock_entries (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL
                REFERENCES users(id) ON DELETE CASCADE,
    customer    TEXT,
    description TEXT NOT NULL DEFAULT '',
    start_at    TIMESTAMPTZ NOT NULL,
    end_at      TIMESTAMPTZ,
    task_id     TEXT,
    contract    TEXT,
    notes       TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    invoiced    BOOLEAN NOT NULL DEFAULT false,
    deleted_at  TIMESTAMPTZ,
    synced_at   TIMESTAMPTZ,
    project     TEXT
);

-- ── ref_customers ────────────────────────────────────────

CREATE TABLE ref_customers (
    user_id  UUID NOT NULL
             REFERENCES users(id) ON DELETE CASCADE,
    name     TEXT NOT NULL,
    snapshot JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (user_id, name)
);

-- ── ref_tasks ────────────────────────────────────────────

CREATE TABLE ref_tasks (
    user_id  UUID NOT NULL
             REFERENCES users(id) ON DELETE CASCADE,
    task_id  TEXT NOT NULL,
    customer TEXT,
    title    TEXT NOT NULL,
    status   TEXT NOT NULL,
    PRIMARY KEY (user_id, task_id)
);

-- ── ai_usage ─────────────────────────────────────────────

CREATE TABLE ai_usage (
    user_id       UUID NOT NULL
                  REFERENCES users(id) ON DELETE CASCADE,
    month         TEXT NOT NULL,
    input_tokens  BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    request_count INT NOT NULL DEFAULT 0,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, month)
);

-- ── inbox_entries ────────────────────────────────────────

CREATE TABLE inbox_entries (
    id          UUID PRIMARY KEY,
    user_id     UUID NOT NULL
                REFERENCES users(id) ON DELETE CASCADE,
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

-- ── tasks ────────────────────────────────────────────────
-- 007 base; 021 added project / milestone.

CREATE TABLE tasks (
    id          TEXT NOT NULL,
    user_id     UUID NOT NULL
                REFERENCES users(id) ON DELETE CASCADE,
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
    project     TEXT,
    milestone   TEXT,
    PRIMARY KEY (user_id, id)
);

-- ── notes ────────────────────────────────────────────────
-- 008 base; 021 added project.

CREATE TABLE notes (
    id          TEXT NOT NULL,
    user_id     UUID NOT NULL
                REFERENCES users(id) ON DELETE CASCADE,
    customer    TEXT NOT NULL DEFAULT '',
    title       TEXT NOT NULL,
    body        TEXT NOT NULL DEFAULT '',
    tags        TEXT[] NOT NULL DEFAULT '{}',
    task_id     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ,
    synced_at   TIMESTAMPTZ,
    project     TEXT,
    PRIMARY KEY (user_id, id)
);

-- ── ref_config ───────────────────────────────────────────

CREATE TABLE ref_config (
    user_id    UUID PRIMARY KEY
               REFERENCES users(id) ON DELETE CASCADE,
    config     JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── gateway_config (single row, id = 1) ──────────────────
-- 011 base; 012 added the https CHECK.

CREATE TABLE gateway_config (
    id                     INT PRIMARY KEY DEFAULT 1
                           CHECK (id = 1),
    backend_url            TEXT NOT NULL
                           DEFAULT 'https://openrouter.ai/api/v1/chat/completions',
    backend_api_key_env    TEXT NOT NULL
                           DEFAULT 'OPENROUTER_API_KEY',
    backend_label          TEXT NOT NULL
                           DEFAULT 'openrouter',
    monthly_token_cap      INT NOT NULL DEFAULT 250000,
    model_advisor          TEXT NOT NULL
                           DEFAULT 'anthropic/claude-haiku-4.5',
    model_cron             TEXT NOT NULL
                           DEFAULT 'google/gemma-4-31b-it',
    model_default          TEXT NOT NULL
                           DEFAULT 'anthropic/claude-haiku-4.5',
    max_tokens_per_request INT NOT NULL DEFAULT 8192,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT gateway_config_backend_url_https
        CHECK (backend_url LIKE 'https://%')
);

INSERT INTO gateway_config (id) VALUES (1);

-- ── cloud_jobs (hosted cron definitions) ─────────────────

CREATE TABLE cloud_jobs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL
                 REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    schedule     TEXT NOT NULL,
    prompt       TEXT NOT NULL,
    model        TEXT NOT NULL DEFAULT '',
    output       TEXT NOT NULL DEFAULT 'inbox',
    timeout      INT NOT NULL DEFAULT 600 CHECK (timeout > 0),
    enabled      BOOLEAN NOT NULL DEFAULT true,
    last_run_at  TIMESTAMPTZ,
    last_status  TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── cloud_job_runs (execution ledger / queue) ────────────

CREATE TABLE cloud_job_runs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id       UUID NOT NULL
                 REFERENCES cloud_jobs(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL
                 REFERENCES users(id) ON DELETE CASCADE,
    status       TEXT NOT NULL DEFAULT 'queued',
    model        TEXT NOT NULL DEFAULT '',
    tokens_used  BIGINT NOT NULL DEFAULT 0,
    output       TEXT,
    error        TEXT,
    started_at   TIMESTAMPTZ,
    finished_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── user_integrations (encrypted credentials) ────────────

CREATE TABLE user_integrations (
    user_id     UUID NOT NULL
                REFERENCES users(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL
                CHECK (kind IN (
                    'linear', 'github', 'google', 'slack'
                )),
    credentials TEXT NOT NULL,
    scopes      TEXT[],
    expires_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, kind)
);

-- ── projects ─────────────────────────────────────────────

CREATE TABLE projects (
    id          TEXT NOT NULL,
    user_id     UUID NOT NULL
                REFERENCES users(id) ON DELETE CASCADE,
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

-- ── cron_health (worker liveness, single row) ────────────

CREATE TABLE cron_health (
    id                 SMALLINT PRIMARY KEY DEFAULT 1
                       CHECK (id = 1),
    last_reconcile_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    reconcile_count    BIGINT NOT NULL DEFAULT 0
);

INSERT INTO cron_health (id) VALUES (1)
    ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────

-- users
CREATE INDEX idx_users_api_key_prefix
    ON users (api_key_prefix)
    WHERE api_key_prefix IS NOT NULL;

-- clock_entries
CREATE INDEX idx_clock_user_start
    ON clock_entries (user_id, start_at);
CREATE INDEX idx_clock_user_updated
    ON clock_entries (user_id, updated_at);
CREATE INDEX idx_clock_user_deleted
    ON clock_entries (user_id, deleted_at)
    WHERE deleted_at IS NOT NULL;
-- Only one running, non-deleted timer per user.
CREATE UNIQUE INDEX idx_one_active
    ON clock_entries (user_id)
    WHERE end_at IS NULL AND deleted_at IS NULL;

-- inbox_entries
CREATE INDEX idx_inbox_user_updated
    ON inbox_entries (user_id, updated_at);
CREATE INDEX idx_inbox_user_deleted
    ON inbox_entries (user_id, deleted_at)
    WHERE deleted_at IS NOT NULL;

-- tasks
CREATE INDEX idx_tasks_user_updated
    ON tasks (user_id, updated_at);
CREATE INDEX idx_tasks_deleted
    ON tasks (user_id, deleted_at)
    WHERE deleted_at IS NOT NULL;

-- notes
CREATE INDEX idx_notes_user_updated
    ON notes (user_id, updated_at);
CREATE INDEX idx_notes_deleted
    ON notes (user_id, deleted_at)
    WHERE deleted_at IS NOT NULL;

-- cloud_jobs
CREATE INDEX idx_cloud_jobs_user
    ON cloud_jobs (user_id);
CREATE INDEX idx_cloud_jobs_enabled
    ON cloud_jobs (enabled) WHERE enabled;

-- cloud_job_runs
CREATE INDEX idx_cloud_job_runs_job_created
    ON cloud_job_runs (job_id, created_at DESC);
CREATE INDEX idx_cloud_job_runs_status
    ON cloud_job_runs (status, created_at)
    WHERE status IN ('queued', 'running');

-- projects
CREATE INDEX idx_projects_user_updated
    ON projects (user_id, updated_at);
CREATE INDEX idx_projects_deleted
    ON projects (user_id, deleted_at)
    WHERE deleted_at IS NOT NULL;

-- ─────────────────────────────────────────────────────────
-- Functions (RPCs)
-- ─────────────────────────────────────────────────────────

-- increment_ai_usage: atomic upsert of usage counters (005).
CREATE OR REPLACE FUNCTION increment_ai_usage(
    p_user_id UUID,
    p_month   TEXT,
    p_input   BIGINT,
    p_output  BIGINT
) RETURNS VOID AS $$
BEGIN
    INSERT INTO ai_usage (
        user_id, month,
        input_tokens, output_tokens,
        request_count, updated_at
    ) VALUES (
        p_user_id, p_month,
        p_input, p_output,
        1, now()
    )
    ON CONFLICT (user_id, month) DO UPDATE SET
        input_tokens  = ai_usage.input_tokens + p_input,
        output_tokens = ai_usage.output_tokens + p_output,
        request_count = ai_usage.request_count + 1,
        updated_at    = now();
END;
$$ LANGUAGE plpgsql;

-- wipe_user_sync_state: single-transaction wipe of all
-- per-user sync tables (018, extended in 022 with projects).
-- Returns the total number of rows deleted.
CREATE OR REPLACE FUNCTION wipe_user_sync_state(
    p_user_id UUID
) RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    total BIGINT := 0;
    n     BIGINT;
BEGIN
    DELETE FROM clock_entries WHERE user_id = p_user_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;

    DELETE FROM inbox_entries WHERE user_id = p_user_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;

    DELETE FROM tasks WHERE user_id = p_user_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;

    DELETE FROM notes WHERE user_id = p_user_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;

    DELETE FROM projects WHERE user_id = p_user_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;

    DELETE FROM ref_customers WHERE user_id = p_user_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;

    DELETE FROM ref_tasks WHERE user_id = p_user_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;

    RETURN total;
END;
$$;

-- find_user_id_by_email: direct email -> id lookup for
-- /auth/forgot-password (020). Reimplemented to read the
-- self-owned users.email column. Returns NULL on miss.
CREATE OR REPLACE FUNCTION find_user_id_by_email(
    p_email TEXT
) RETURNS UUID AS $$
    SELECT id FROM users
     WHERE email = p_email
     LIMIT 1;
$$ LANGUAGE SQL;

COMMENT ON FUNCTION find_user_id_by_email(TEXT) IS
    'Direct lookup used by /auth/forgot-password. Reads '
    'users.email. Returns NULL on miss.';

-- ─────────────────────────────────────────────────────────
-- Triggers
-- ─────────────────────────────────────────────────────────

-- Auto-update gateway_config.updated_at on every change.
CREATE OR REPLACE FUNCTION touch_gateway_config_updated()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER touch_gateway_config_updated
    BEFORE UPDATE ON gateway_config
    FOR EACH ROW
    EXECUTE FUNCTION touch_gateway_config_updated();
