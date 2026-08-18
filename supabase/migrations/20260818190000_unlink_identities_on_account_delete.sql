-- When an account is deleted in-app we tombstone the auth email and ban the
-- user (hard-delete would CASCADE-wipe orders). Google / Apple / phone
-- identities must be dropped or the same login signs back into the banned user.
-- Apply manually — do not run from the agent.

CREATE OR REPLACE FUNCTION public.unlink_deleted_user_login_identities(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public, pg_temp
AS $$
BEGIN
  DELETE FROM auth.identities
  WHERE user_id = p_user_id
    AND provider IS DISTINCT FROM 'email';

  UPDATE auth.users
  SET
    phone = NULL,
    phone_confirmed_at = NULL
  WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.unlink_deleted_user_login_identities(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unlink_deleted_user_login_identities(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.on_auth_user_account_deleted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public, pg_temp
AS $$
BEGIN
  IF NEW.email LIKE 'deleted-%@deleted.invalid'
     OR coalesce(NEW.raw_app_meta_data->>'deleted', '') = 'true'
  THEN
    DELETE FROM auth.identities
    WHERE user_id = NEW.id
      AND provider IS DISTINCT FROM 'email';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_account_deleted ON auth.users;
CREATE TRIGGER on_auth_user_account_deleted
AFTER UPDATE ON auth.users
FOR EACH ROW
WHEN (
  NEW.email LIKE 'deleted-%@deleted.invalid'
  OR coalesce(NEW.raw_app_meta_data->>'deleted', '') = 'true'
)
EXECUTE FUNCTION public.on_auth_user_account_deleted();
