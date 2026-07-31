-- Align SQL area resolution with the app: named cities first, then a GPS grid cell.

create or replace function public.pricing_coord_token(p_value double precision)
returns text
language sql
immutable
as $$
  select replace(
    replace(to_char(round(p_value::numeric, 2), 'FM999990.00'), '-', 'n'),
    '.',
    'd'
  );
$$;

comment on function public.pricing_coord_token(double precision) is
  'Stable token for a snapped pricing coordinate (matches lib/pricing/areas.ts).';

create or replace function public.resolve_pricing_area_id(
  p_lat double precision,
  p_lng double precision
) returns text
language plpgsql
stable
as $$
declare
  v_id text;
  v_lat double precision;
  v_lng double precision;
begin
  if p_lat is null or p_lng is null then
    return 'unknown';
  end if;

  select id into v_id
  from public.pricing_areas
  where is_active = true
    and public.haversine_km(p_lat, p_lng, center_lat, center_lng) <= radius_km
  order by public.haversine_km(p_lat, p_lng, center_lat, center_lng) asc
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  v_lat := round(p_lat / 0.2) * 0.2;
  v_lng := round(p_lng / 0.2) * 0.2;
  v_id := 'gps_' || public.pricing_coord_token(v_lat) || '_' || public.pricing_coord_token(v_lng);

  insert into public.pricing_areas (
    id,
    name,
    country,
    center_lat,
    center_lng,
    radius_km,
    is_active,
    updated_at
  )
  values (
    v_id,
    format('Local market %s, %s', round(v_lat::numeric, 2), round(v_lng::numeric, 2)),
    'XX',
    v_lat,
    v_lng,
    25,
    true,
    now()
  )
  on conflict (id) do nothing;

  return v_id;
end;
$$;

comment on function public.resolve_pricing_area_id(double precision, double precision) is
  'Map GPS to a named pricing area or auto-register a local coordinate cell.';

grant execute on function public.pricing_coord_token(double precision) to anon, authenticated, service_role;
