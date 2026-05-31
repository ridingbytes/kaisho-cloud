-- Direct email -> user id lookup for /auth/forgot-password.
--
-- Supabase Admin API does not support filtering by email;
-- listUsers() pages through every user. That scan grows
-- linearly with the project's user count and would dominate
-- the forgot-password endpoint's latency past a few
-- thousand users.
--
-- A SECURITY DEFINER function gives the service role a
-- bounded, indexed lookup against auth.users without
-- exposing the table directly. Returns NULL on miss so
-- the caller can keep the "always 200 to prevent email
-- enumeration" semantics without an extra check.

CREATE OR REPLACE FUNCTION find_user_id_by_email(
    p_email TEXT
) RETURNS UUID AS $$
    SELECT id FROM auth.users
     WHERE email = p_email
     LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION find_user_id_by_email(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION find_user_id_by_email(TEXT)
  TO service_role;

COMMENT ON FUNCTION find_user_id_by_email(TEXT) IS
  'Direct lookup used by /auth/forgot-password to avoid '
  'the linear auth.admin.listUsers() scan. Service-role '
  'only. Returns NULL on miss.';
