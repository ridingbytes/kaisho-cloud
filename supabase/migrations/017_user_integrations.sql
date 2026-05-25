-- Per-user external integration credentials (Pro tier).
--
-- Stores OAuth tokens / API keys for the premium MCP
-- integrations (Linear, GitHub, Google Calendar, Slack).
-- The ``credentials`` column holds an AES-256-GCM blob
-- (see api/utils/crypto.js) — the plaintext token never
-- touches the DB. The encryption key lives only in the
-- INTEGRATION_KEY env var, so a DB dump alone can't
-- recover any third-party tokens.
--
-- One row per (user, kind). RLS deny-all: access is only
-- via the service key through the integration store.

CREATE TABLE IF NOT EXISTS user_integrations (
    user_id     UUID NOT NULL
                REFERENCES users(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL
                CHECK (kind IN (
                    'linear', 'github', 'google', 'slack'
                )),
    -- AES-256-GCM blob "iv.tag.ciphertext" (base64 parts).
    credentials TEXT NOT NULL,
    scopes      TEXT[],
    -- For OAuth tokens that expire; NULL for API keys.
    expires_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, kind)
);

ALTER TABLE user_integrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all ON user_integrations;
CREATE POLICY deny_all ON user_integrations
    FOR ALL USING (false);

-- Rollback:
--   DROP TABLE IF EXISTS user_integrations;
