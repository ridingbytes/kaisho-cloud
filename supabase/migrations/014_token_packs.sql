-- Overage packs for the Companion / Pro / Team tiers.
--
-- The monthly token cap from PLAN_QUOTAS gives a baseline
-- allowance. When a user wants to exceed it within the
-- same month, they buy a one-time token pack
-- (price token_pack_500k = €15 for 500,000 tokens).
-- The Stripe webhook handler INSERTs one row into
-- ``token_packs`` per successful purchase and bumps
-- ``users.bonus_tokens_remaining`` by the pack size.
--
-- The AI gateway's quota check (api/routes/ai.js) reads
-- the user's monthly usage from ``ai_usage`` and adds
-- ``bonus_tokens_remaining`` to the effective cap. Bonus
-- tokens carry over across months until consumed —
-- they are not a recurring entitlement.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + ALTER TABLE
-- ADD COLUMN IF NOT EXISTS, so the migration can be
-- re-applied without errors.

-- ── Bonus column on users ───────────────────────────────

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS bonus_tokens_remaining
    BIGINT NOT NULL DEFAULT 0;

-- Guard against accidental negatives. A bug that
-- decrements below zero should surface here, not
-- silently grant infinite tokens.
ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_bonus_tokens_nonneg;
ALTER TABLE users
    ADD CONSTRAINT users_bonus_tokens_nonneg
    CHECK (bonus_tokens_remaining >= 0);

-- ── Token-pack purchase ledger ──────────────────────────

CREATE TABLE IF NOT EXISTS token_packs (
    id               UUID PRIMARY KEY
                     DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL
                     REFERENCES users(id) ON DELETE CASCADE,
    tokens           BIGINT NOT NULL
                     CHECK (tokens > 0),
    stripe_charge_id TEXT NOT NULL UNIQUE,
    -- Mirrors the price ID at purchase time so we can
    -- distinguish a 500k pack from any future 1M / 2M
    -- variants without re-deriving from `tokens`.
    stripe_price_id  TEXT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_token_packs_user_created
    ON token_packs (user_id, created_at DESC);

ALTER TABLE token_packs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all ON token_packs;
CREATE POLICY deny_all ON token_packs
    FOR ALL USING (false);

-- Rollback (for incident response):
--
--   DROP TABLE IF EXISTS token_packs;
--   ALTER TABLE users
--       DROP CONSTRAINT IF EXISTS users_bonus_tokens_nonneg;
--   ALTER TABLE users
--       DROP COLUMN IF EXISTS bonus_tokens_remaining;
--
-- Note: dropping the column loses any unused bonus
-- tokens. Refund any active token_packs purchases before
-- running the rollback.
