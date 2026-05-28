-- Atomic, single-transaction wipe of all per-user sync
-- state. Called from DELETE /sync/entries when the desktop
-- disconnects, so the cloud is a clean slate for the next
-- connect.
--
-- The previous JS implementation deleted from 6 tables in
-- a loop; if any DELETE failed midway the user was left
-- half-wiped (the next reconnect rebuilt some tables but
-- carried stale rows in others). Wrap in one server-side
-- function so it's a single transaction: all-or-nothing.
--
-- The local org file is the single source of truth — the
-- cloud is a disposable mirror that gets rebuilt from a
-- full push on the next connect.

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
