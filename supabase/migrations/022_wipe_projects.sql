-- Extend wipe_user_sync_state to also clear the projects
-- table added in migration 021. DELETE /sync/entries wipes
-- every per-user sync table on desktop disconnect so the
-- cloud is a clean slate for the next full push; projects
-- must be part of that all-or-nothing wipe or a stale
-- project would survive a reconnect.
--
-- Only the projects DELETE is new; the rest is copied
-- verbatim from migration 018 so the function stays a
-- single atomic transaction.

CREATE OR REPLACE FUNCTION public.wipe_user_sync_state(
  p_user_id UUID
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total BIGINT := 0;
  n     BIGINT;
BEGIN
  DELETE FROM clock_entries WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  total := total + n;

  DELETE FROM inbox_entries WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  total := total + n;

  DELETE FROM tasks WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  total := total + n;

  DELETE FROM notes WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  total := total + n;

  DELETE FROM projects WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  total := total + n;

  DELETE FROM ref_customers WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  total := total + n;

  DELETE FROM ref_tasks WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  total := total + n;

  RETURN total;
END;
$$;

REVOKE ALL ON FUNCTION public.wipe_user_sync_state(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wipe_user_sync_state(UUID)
  TO service_role;
