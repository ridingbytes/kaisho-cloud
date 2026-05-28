-- Liveness signal for the hosted cron worker
-- (api/workers/cron.js). Single-row table updated on every
-- reconcile tick. An operator (or future alerting) can
-- query last_reconcile_at to detect a hung or crashed
-- worker without standing up a side HTTP server inside the
-- worker process.

CREATE TABLE IF NOT EXISTS public.cron_health (
  id                 SMALLINT PRIMARY KEY DEFAULT 1
                     CHECK (id = 1),
  last_reconcile_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reconcile_count    BIGINT      NOT NULL DEFAULT 0
);

INSERT INTO public.cron_health (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;

REVOKE ALL ON TABLE public.cron_health
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.cron_health
  TO service_role;
