-- Do not let skills save / Connect start downgrade an active (or suspended)
-- provider grant back to pending.
-- Also drop incomplete provider_details stubs with no grant (Lupin leftover).
-- Apply manually — do not run from the agent.

create or replace function public.upsert_account_role_grant(
  p_user_id uuid,
  p_role text,
  p_status text,
  p_activate boolean default false
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_role not in ('customer', 'provider') then
    raise exception 'invalid role %', p_role;
  end if;
  if p_status not in ('pending', 'active', 'suspended') then
    raise exception 'invalid status %', p_status;
  end if;

  insert into public.account_role_grants as g (user_id, role, status, activated_at, updated_at)
  values (
    p_user_id,
    p_role,
    p_status,
    case
      when p_status = 'active' or p_activate then coalesce(
        (select activated_at from public.account_role_grants where user_id = p_user_id and role = p_role),
        now()
      )
      else null
    end,
    now()
  )
  on conflict (user_id, role) do update
  set
    status = case
      when g.status in ('active', 'suspended') and excluded.status = 'pending'
        then g.status
      else excluded.status
    end,
    activated_at = case
      when excluded.status = 'active'
        and (g.activated_at is null or g.status is distinct from 'active')
      then now()
      when excluded.status = 'active' then coalesce(g.activated_at, now())
      when g.status in ('active', 'suspended') and excluded.status = 'pending'
        then g.activated_at
      else g.activated_at
    end,
    updated_at = now();
end;
$$;

-- Incomplete provider stubs: no grant, no skills, never approved, never booked as provider.
delete from public.provider_details pd
where not exists (
  select 1
  from public.account_role_grants g
  where g.user_id = pd.id and g.role = 'provider'
)
and not exists (
  select 1 from public.provider_skills ps where ps.provider_id = pd.id
)
and coalesce(pd.admin_approved, false) = false
and coalesce(pd.stripe_payouts_enabled, false) = false
and not exists (
  select 1 from public.orders o where o.provider_id = pd.id
);
