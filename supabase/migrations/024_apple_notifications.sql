-- App Store Server Notifications V2 idempotency ledger.
--
-- Apple delivers subscription lifecycle events (renew,
-- expire, refund, …) to POST /billing/apple/notifications,
-- with at-least-once delivery. The webhook claims each
-- notificationUUID by inserting it here first; a duplicate
-- delivery hits the primary key and is skipped. Mirrors the
-- stripe_events pattern in 001_schema.sql.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS apple_notifications (
    notification_uuid TEXT PRIMARY KEY,
    notification_type TEXT,
    subtype           TEXT,
    received_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE apple_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all ON apple_notifications;
CREATE POLICY deny_all ON apple_notifications
    FOR ALL USING (false);

-- Rollback:
--   DROP TABLE IF EXISTS apple_notifications;
