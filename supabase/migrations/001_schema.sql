-- Kaisho Cloud — initial schema
--
-- Users table extends Supabase Auth. Clock entries store
-- mobile-created time entries. Reference tables hold
-- read-only snapshots of local customer/task data.

-- ── Users ────────────────────────────────────────────────

CREATE TABLE users (
    id                     UUID PRIMARY KEY
                           REFERENCES auth.users(id)
                           ON DELETE CASCADE,
    api_key_hash           TEXT,
    plan                   TEXT NOT NULL DEFAULT 'free',
    stripe_customer_id     TEXT,
    stripe_subscription_id TEXT,
    created_at             TIMESTAMPTZ NOT NULL
                           DEFAULT now()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all ON users FOR ALL USING (false);

-- ── Clock entries ────────────────────────────────────────

CREATE TABLE clock_entries (
    id          UUID PRIMARY KEY
                DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL
                REFERENCES users(id) ON DELETE CASCADE,
    customer    TEXT,
    description TEXT NOT NULL DEFAULT '',
    start_at    TIMESTAMPTZ NOT NULL,
    end_at      TIMESTAMPTZ,
    task_id     TEXT,
    contract    TEXT,
    notes       TEXT NOT NULL DEFAULT '',
    booked      BOOLEAN NOT NULL DEFAULT false,
    synced      BOOLEAN NOT NULL DEFAULT false,
    synced_at   TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_clock_user_synced
    ON clock_entries(user_id, synced);
CREATE INDEX idx_clock_user_start
    ON clock_entries(user_id, start_at);

-- Only one running timer per user
CREATE UNIQUE INDEX idx_one_active
    ON clock_entries(user_id)
    WHERE end_at IS NULL;

ALTER TABLE clock_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all ON clock_entries
    FOR ALL USING (false);

-- ── Reference: customers ─────────────────────────────────

CREATE TABLE ref_customers (
    user_id  UUID NOT NULL
             REFERENCES users(id) ON DELETE CASCADE,
    name     TEXT NOT NULL,
    snapshot JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (user_id, name)
);

ALTER TABLE ref_customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all ON ref_customers
    FOR ALL USING (false);

-- ── Reference: tasks ─────────────────────────────────────

CREATE TABLE ref_tasks (
    user_id  UUID NOT NULL
             REFERENCES users(id) ON DELETE CASCADE,
    task_id  TEXT NOT NULL,
    customer TEXT,
    title    TEXT NOT NULL,
    status   TEXT NOT NULL,
    PRIMARY KEY (user_id, task_id)
);

ALTER TABLE ref_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all ON ref_tasks
    FOR ALL USING (false);

-- ── Stripe event idempotency ─────────────────────────────

CREATE TABLE stripe_events (
    id           TEXT PRIMARY KEY,
    type         TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all ON stripe_events
    FOR ALL USING (false);
