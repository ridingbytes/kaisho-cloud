-- Defensive constraints on gateway_config and the
-- per-user override columns added in migration 011.
--
-- Each constraint catches a single class of operator
-- error and a single class of attacker (someone with
-- write access to the DB but not the runtime env vars).

-- 1. backend_url must be https. Plain http would send
--    the master API key as a cleartext Bearer token.
ALTER TABLE gateway_config
    ADD CONSTRAINT gateway_config_backend_url_https
    CHECK (backend_url LIKE 'https://%');

-- 2. monthly_token_cap_override must be in a sane range
--    so an accidental UPDATE setting MAX_INT (or a
--    negative typo) doesn't silently disable metering.
--    10M tokens is far above any realistic user cap.
ALTER TABLE users
    ADD CONSTRAINT users_token_cap_override_range
    CHECK (
        monthly_token_cap_override IS NULL
        OR (
            monthly_token_cap_override >= 0
            AND monthly_token_cap_override <= 10000000
        )
    );

-- Note: we intentionally do not constrain
-- backend_api_key_env or *_model_override values at the
-- DB level. Those are validated in code against an
-- allowlist (see api/routes/ai.js) so the allowlist can
-- evolve without a schema migration.
