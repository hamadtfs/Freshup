-- Phone OTP identity resolution: look up auth.users by phone without scanning.
-- Service role only (revoke from public / authenticated).

create or replace function public.auth_user_id_for_phone(p_phone text)
returns uuid
language sql
stable
security definer
set search_path = auth, public
as $$
  select u.id
  from auth.users u
  where nullif(regexp_replace(coalesce(u.phone, ''), '\D', '', 'g'), '')
        = nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '')
  limit 1;
$$;

comment on function public.auth_user_id_for_phone(text) is
  'Returns auth.users.id for a phone number (E.164 or digits). Used by phone OTP identity checks.';

revoke all on function public.auth_user_id_for_phone(text) from public;
revoke all on function public.auth_user_id_for_phone(text) from anon;
revoke all on function public.auth_user_id_for_phone(text) from authenticated;
grant execute on function public.auth_user_id_for_phone(text) to service_role;
