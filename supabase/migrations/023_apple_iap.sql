-- Apple in-app purchase (StoreKit 2) support.
--
-- The iOS app is local-first; a paid plan can now be
-- granted by an Apple subscription in addition to Stripe.
-- users.plan stays the single effective plan the API
-- enforces, but it is no longer written directly by a
-- payment handler. Each source records its own grant and
-- resolveEffectivePlan() (api/billing/plans.js) recomputes
-- users.plan as the highest active tier across both:
--
--   users.stripe_plan  -- plan Stripe currently grants
--   users.apple_plan   -- plan Apple currently grants
--   users.apple_expires_at -- when the Apple grant lapses
--
-- so an active subscription from either source grants the
-- plan and one source expiring never wipes the other's.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS throughout, and the
-- unique index / backfill are guarded so re-runs are safe.

-- ── New columns ─────────────────────────────────────────

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS stripe_plan TEXT,
    ADD COLUMN IF NOT EXISTS apple_original_transaction_id TEXT,
    ADD COLUMN IF NOT EXISTS apple_product_id TEXT,
    ADD COLUMN IF NOT EXISTS apple_plan TEXT,
    ADD COLUMN IF NOT EXISTS apple_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS apple_environment TEXT;

-- One Apple subscription (identified by its original
-- transaction id) maps to exactly one user. The partial
-- unique index lets the many NULL rows coexist while
-- pinning the mapping for rows that carry an id, so a
-- notification can resolve its user unambiguously.
CREATE UNIQUE INDEX IF NOT EXISTS
    users_apple_original_txn_id_key
    ON users (apple_original_transaction_id)
    WHERE apple_original_transaction_id IS NOT NULL;

-- Constrain the per-source plan columns to the same tiers
-- as users.plan (NULL = no grant from that source).
ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_stripe_plan_check;
ALTER TABLE users
    ADD CONSTRAINT users_stripe_plan_check
    CHECK (stripe_plan IN ('companion', 'pro', 'team'));

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_apple_plan_check;
ALTER TABLE users
    ADD CONSTRAINT users_apple_plan_check
    CHECK (apple_plan IN ('companion', 'pro', 'team'));

-- ── Backfill ────────────────────────────────────────────

-- Existing paid users got their plan from Stripe (or a
-- manual grant). Seed stripe_plan from the current plan so
-- the first reconcile after deploy does not downgrade
-- anyone: with apple_plan still NULL, the effective plan
-- resolves back to exactly today's value.
UPDATE users
    SET stripe_plan = plan
    WHERE plan IN ('companion', 'pro', 'team')
      AND stripe_plan IS NULL;

-- Rollback (incident response):
--
--   ALTER TABLE users
--       DROP CONSTRAINT IF EXISTS users_apple_plan_check,
--       DROP CONSTRAINT IF EXISTS users_stripe_plan_check;
--   DROP INDEX IF EXISTS users_apple_original_txn_id_key;
--   ALTER TABLE users
--       DROP COLUMN IF EXISTS apple_environment,
--       DROP COLUMN IF EXISTS apple_expires_at,
--       DROP COLUMN IF EXISTS apple_plan,
--       DROP COLUMN IF EXISTS apple_product_id,
--       DROP COLUMN IF EXISTS apple_original_transaction_id,
--       DROP COLUMN IF EXISTS stripe_plan;
--
-- The webhook/verify code that writes stripe_plan / apple_*
-- must roll back together with this SQL — reverting the SQL
-- alone leaves the handlers writing dropped columns.
