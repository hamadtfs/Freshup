-- Backward-compatibility layer for legacy customer REST API consumers.
-- Fixes:
-- 1) /rest/v1/provider_profiles (legacy name) -> mapped from provider_details.
-- 2) /rest/v1/provider_categories?select=provider_id,category (legacy column) -> alias from category_id.

-- 1) Legacy view: provider_profiles
create or replace view public.provider_profiles as
select
  pd.id as provider_id,
  pd.lat,
  pd.lng,
  pd.is_online,
  coalesce('home' = any(pd.delivery_modes), false) as home_service
from public.provider_details pd;

grant select on public.provider_profiles to anon, authenticated, service_role;

-- 2) Legacy alias column: provider_categories.category
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'provider_categories'
      and column_name = 'category'
  ) then
    alter table public.provider_categories
      add column category text generated always as (category_id) stored;
  end if;
end $$;
