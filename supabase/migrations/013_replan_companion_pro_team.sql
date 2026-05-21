-- Rename plan values from the old SaaS shape
-- (sync / sync_ai) to the Track AI tiers
-- (companion / pro / team), and add a check constraint
-- so future plan values stay in the supported set.
--
-- Idempotent: the UPDATEs are no-ops when the source
-- value is already absent; the CHECK is dropped and
-- recreated so the migration can re-run without
-- "constraint already exists" errors.

-- 1. Rename existing plan values. There should be zero
--    rows in the wild at the time of writing (no paying
--    customers), but the UPDATEs are safe regardless.
UPDATE users SET plan = 'companion' WHERE plan = 'sync';
UPDATE users SET plan = 'pro'       WHERE plan = 'sync_ai';

-- 2. Pin the plan column to the four supported tiers.
--    Drop any prior constraint by the same name first so
--    re-runs do not collide.
ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_plan_check;

ALTER TABLE users
    ADD CONSTRAINT users_plan_check
    CHECK (plan IN ('free', 'companion', 'pro', 'team'));

-- Rollback (for incident response, if a Companion price
-- ever has to be reverted to the legacy SKU layout):
--
--   ALTER TABLE users
--       DROP CONSTRAINT users_plan_check;
--   UPDATE users SET plan = 'sync'    WHERE plan = 'companion';
--   UPDATE users SET plan = 'sync_ai' WHERE plan = 'pro';
--   UPDATE users SET plan = 'free'    WHERE plan = 'team';
--
-- The webhook handler change in the matching code commit
-- must roll back together with the SQL — otherwise new
-- subscriptions write the new plan names against the old
-- constraint and fail.
