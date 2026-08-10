-- Explicit per-user role grants (Munib identity model).
-- Source of truth for "which roles does this account have" and grant status.
-- Apply manually — do not run from the agent.
--
-- Rules:
-- - One row per (user_id, role)
-- - provider starts pending; becomes active when admin approves
-- - customer is active when customer path exists (signup or first booking)
-- - handle_new_auth_user only creates the signup role's details + grant

create table if not exists public.account_role_grants (
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('customer', 'provider')),
  status text not null check (status in ('pending', 'active', 'suspended')),
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, role)
);

create index if not exists idx_account_role_grants_user_status
  on public.account_role_grants (user_id, status);

comment on table public.account_role_grants is
  'Explicit role grants. active = usable for mode switch / dual-role. '
  'provider pending until admin verification; customer active when role is established.';

alter table public.account_role_grants enable row level security;

drop policy if exists "Users can read own role grants" on public.account_role_grants;
create policy "Users can read own role grants"
  on public.account_role_grants
  for select
  using (auth.uid() = user_id);

-- Writes only via service role / SECURITY DEFINER helpers (no user insert/update policies).

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
    status = excluded.status,
    activated_at = case
      when excluded.status = 'active'
        and (g.activated_at is null or g.status is distinct from 'active')
      then now()
      when excluded.status = 'active' then coalesce(g.activated_at, now())
      else g.activated_at
    end,
    updated_at = now();
end;
$$;

grant execute on function public.upsert_account_role_grant(uuid, text, text, boolean)
  to service_role;

-- Backfill from existing detail rows.
insert into public.account_role_grants (user_id, role, status, activated_at, created_at, updated_at)
select
  cd.id,
  'customer',
  'active',
  now(),
  now(),
  now()
from public.customer_details cd
on conflict (user_id, role) do nothing;

insert into public.account_role_grants (user_id, role, status, activated_at, created_at, updated_at)
select
  pd.id,
  'provider',
  case when coalesce(pd.admin_approved, false) then 'active' else 'pending' end,
  case
    when coalesce(pd.admin_approved, false) then now()
    else null::timestamptz
  end,
  coalesce(pd.created_at, now()),
  now()
from public.provider_details pd
on conflict (user_id, role) do nothing;

-- Providers with skills but missing provider_details (edge cases).
insert into public.account_role_grants (user_id, role, status, activated_at, created_at, updated_at)
select distinct
  ps.provider_id,
  'provider',
  'pending',
  null::timestamptz,
  now(),
  now()
from public.provider_skills ps
where not exists (
  select 1 from public.account_role_grants g
  where g.user_id = ps.provider_id and g.role = 'provider'
)
on conflict (user_id, role) do nothing;

-- Signup trigger: only the chosen role's details + matching grant.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  customer_role_id uuid;
  provider_role_id uuid;
  picked_role_id uuid;
  app_role text;
begin
  select id into customer_role_id from public.roles where slug = 'customer' limit 1;
  select id into provider_role_id from public.roles where slug = 'provider' limit 1;

  app_role := coalesce(new.raw_user_meta_data ->> 'app_role', 'customer');
  picked_role_id := case
    when app_role = 'provider' then provider_role_id
    else customer_role_id
  end;

  insert into public.profiles (id, role_id, display_name, phone, email)
  values (
    new.id,
    picked_role_id,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name', ''),
    new.phone,
    new.email
  )
  on conflict (id) do nothing;

  if app_role = 'provider' then
    insert into public.provider_details (id)
    values (new.id)
    on conflict (id) do nothing;
    perform public.upsert_account_role_grant(new.id, 'provider', 'pending', false);
  else
    insert into public.customer_details (id)
    values (new.id)
    on conflict (id) do nothing;
    perform public.upsert_account_role_grant(new.id, 'customer', 'active', true);
  end if;

  return new;
end;
$$;
