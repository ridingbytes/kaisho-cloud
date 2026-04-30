-- AI gateway runtime configuration.
--
-- Two layers of overrides above the env-var defaults
-- baked into routes/ai.js:
--
--   1. gateway_config (single row, id = 1) — global
--      defaults that can be changed by SQL UPDATE
--      without restarting the gateway. Cached in the
--      gateway for ~60s.
--
--   2. users.*_override columns — per-user overrides
--      for the cap and the advisor/cron model. NULL =
--      use the gateway_config value.
--
-- Resolution order (most specific first):
--   user override → gateway_config → env var → code default

-- ── gateway_config ───────────────────────────────────────

CREATE TABLE gateway_config (
    id                     INT PRIMARY KEY DEFAULT 1
                           CHECK (id = 1),
    monthly_token_cap      INT NOT NULL DEFAULT 250000,
    model_advisor          TEXT NOT NULL
                           DEFAULT 'anthropic/claude-haiku-4.5',
    model_cron             TEXT NOT NULL
                           DEFAULT 'google/gemma-4-31b-it',
    model_default          TEXT NOT NULL
                           DEFAULT 'anthropic/claude-haiku-4.5',
    max_tokens_per_request INT NOT NULL DEFAULT 8192,
    updated_at             TIMESTAMPTZ NOT NULL
                           DEFAULT now()
);

ALTER TABLE gateway_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all ON gateway_config
    FOR ALL USING (false);

INSERT INTO gateway_config (id) VALUES (1);

-- Auto-update updated_at on every change so we know
-- when config last drifted from defaults.
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

-- ── Per-user overrides ───────────────────────────────────

ALTER TABLE users
    ADD COLUMN monthly_token_cap_override INT NULL,
    ADD COLUMN advisor_model_override     TEXT NULL,
    ADD COLUMN cron_model_override        TEXT NULL;

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
