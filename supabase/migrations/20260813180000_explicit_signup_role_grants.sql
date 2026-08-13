-- Explicit signup grants (Munib identity model).
-- Apply manually — do not run from the agent.
--
-- Rules:
-- - Missing app_role at auth insert must NOT default to customer.
-- - Provider signup → pending provider grant only. No details rows yet.
-- - Customer signup → active customer grant. customer_details waits until
--   first booking / explicit ensure.
-- - Never create the other role's grant or details in the signup trigger.

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

  app_role := nullif(trim(new.raw_user_meta_data ->> 'app_role'), '');
  picked_role_id := case
    when app_role = 'provider' then provider_role_id
    when app_role = 'customer' then customer_role_id
    else null
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
    perform public.upsert_account_role_grant(new.id, 'provider', 'pending', false);
  elsif app_role = 'customer' then
    perform public.upsert_account_role_grant(new.id, 'customer', 'active', true);
  end if;

  return new;
end;
$$;

comment on function public.handle_new_auth_user() is
  'Creates profiles on signup. Writes only the explicit app_role grant. '
  'Does not insert customer_details or provider_details.';

-- Provider accounts that never booked: drop the implicit customer half
-- (old trigger defaulted app_role to customer and wrote both detail rows).
delete from public.account_role_grants g
where g.role = 'customer'
  and not exists (
    select 1 from public.orders o where o.customer_id = g.user_id
  )
  and (
    exists (
      select 1
      from public.account_role_grants p
      where p.user_id = g.user_id
        and p.role = 'provider'
    )
    or (
      exists (
        select 1 from public.provider_details pd where pd.id = g.user_id
      )
      and not exists (
        select 1 from public.provider_skills ps where ps.provider_id = g.user_id
      )
    )
  );

delete from public.customer_details cd
where not exists (
  select 1 from public.orders o where o.customer_id = cd.id
)
and (
  exists (
    select 1
    from public.account_role_grants g
    where g.user_id = cd.id and g.role = 'provider'
  )
  or not exists (
    select 1
    from public.account_role_grants g
    where g.user_id = cd.id and g.role = 'customer'
  )
);
