-- Hosted cron jobs for the Companion / Pro / Team tiers.
--
-- The desktop runs cron jobs locally (jobs.yaml). Companion
-- adds the option to mirror a job to the cloud so it fires
-- even when the laptop is closed. The desktop pushes the
-- job spec via POST /cloud/jobs; a Node worker (separate
-- process, see PR B) polls due jobs, runs the prompt
-- through the AI gateway against the user's quota, and
-- persists the result.
--
-- Schema mirrors the desktop job shape (name, schedule,
-- model, prompt, output, timeout, enabled) but stores the
-- prompt text inline — the cloud worker cannot reach the
-- desktop's prompt_file paths.
--
-- ``cloud_job_runs`` is the execution ledger + queue the
-- worker writes to. Kept here (not in PR B) because the
-- two tables form one schema unit.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS throughout.

-- ── Job definitions ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS cloud_jobs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL
                 REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    -- Standard 5-field cron expression, evaluated in UTC.
    schedule     TEXT NOT NULL,
    prompt       TEXT NOT NULL,
    model        TEXT NOT NULL DEFAULT '',
    -- Where the run output goes on the user's data, e.g.
    -- 'inbox'. Free-form so new sinks need no migration.
    output       TEXT NOT NULL DEFAULT 'inbox',
    timeout      INT NOT NULL DEFAULT 600 CHECK (timeout > 0),
    enabled      BOOLEAN NOT NULL DEFAULT true,
    last_run_at  TIMESTAMPTZ,
    last_status  TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cloud_jobs_user
    ON cloud_jobs (user_id);
-- The worker scans enabled jobs to decide what is due.
CREATE INDEX IF NOT EXISTS idx_cloud_jobs_enabled
    ON cloud_jobs (enabled) WHERE enabled;

ALTER TABLE cloud_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all ON cloud_jobs;
CREATE POLICY deny_all ON cloud_jobs
    FOR ALL USING (false);

-- ── Execution ledger / queue ────────────────────────────

CREATE TABLE IF NOT EXISTS cloud_job_runs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id       UUID NOT NULL
                 REFERENCES cloud_jobs(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL
                 REFERENCES users(id) ON DELETE CASCADE,
    -- queued → running → success | error | timeout
    status       TEXT NOT NULL DEFAULT 'queued',
    model        TEXT NOT NULL DEFAULT '',
    tokens_used  BIGINT NOT NULL DEFAULT 0,
    output       TEXT,
    error        TEXT,
    started_at   TIMESTAMPTZ,
    finished_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cloud_job_runs_job_created
    ON cloud_job_runs (job_id, created_at DESC);
-- The worker claims queued rows oldest-first.
CREATE INDEX IF NOT EXISTS idx_cloud_job_runs_status
    ON cloud_job_runs (status, created_at)
    WHERE status IN ('queued', 'running');

ALTER TABLE cloud_job_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all ON cloud_job_runs;
CREATE POLICY deny_all ON cloud_job_runs
    FOR ALL USING (false);

-- Rollback (for incident response):
--
--   DROP TABLE IF EXISTS cloud_job_runs;
--   DROP TABLE IF EXISTS cloud_jobs;
