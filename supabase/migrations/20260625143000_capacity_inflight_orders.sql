-- In-flight jobs (assigned → in_progress) keep counting toward used capacity
-- until completed, even when matching/search started more than 30 minutes ago.
-- Searching orders (pending/offered) still use the rolling 30-minute window.

create or replace function public.compute_used_capacity(
  p_area_id text,
  p_service_id text
) returns numeric
language plpgsql
stable
set search_path = public
as $$
declare
  v_active_bookings integer := 0;
  v_online_providers integer := 0;
begin
  if p_area_id is null or p_area_id = '' or p_area_id = 'unknown' then
    return 0;
  end if;

  if p_service_id is null or p_service_id = '' then
    return 0;
  end if;

  select count(*) into v_active_bookings
  from public.orders o
  where o.service_id = p_service_id
    and o.customer_lat is not null
    and o.customer_lng is not null
    and public.resolve_pricing_area_id(o.customer_lat, o.customer_lng) = p_area_id
    and (
      (
        o.status in ('pending', 'offered')
        and o.created_at >= (now() - interval '30 minutes')
      )
      or o.status in (
        'assigned',
        'en_route',
        'arrived',
        'in_progress'
      )
    );

  select count(distinct pd.id) into v_online_providers
  from public.provider_details pd
  inner join public.provider_skills ps on ps.provider_id = pd.id
  where ps.service_id = p_service_id
    and ps.is_active = true
    and ps.available_now = true
    and pd.lat is not null
    and pd.lng is not null
    and public.resolve_pricing_area_id(pd.lat, pd.lng) = p_area_id;

  if v_online_providers = 0 then
    return 0;
  end if;

  return round(
    (v_active_bookings::numeric / v_online_providers::numeric) * 100,
    2
  );
end;
$$;

comment on function public.compute_used_capacity(text, text) is
  'Used capacity % per (area, service): searching bookings in last 30 min + in-flight jobs / online providers (spec §2.3).';

grant execute on function public.compute_used_capacity(text, text) to anon, authenticated, service_role;
