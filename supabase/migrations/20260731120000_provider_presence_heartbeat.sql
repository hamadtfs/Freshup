-- Provider presence: only count providers with a fresh heartbeat as online.
-- Abandoned sessions (app killed / left without logout) stop matching after ~3 minutes.

create or replace function public.provider_is_live(
  p_is_online boolean,
  p_last_online_at timestamptz
) returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(p_is_online, false)
    and p_last_online_at is not null
    and p_last_online_at > (now() - interval '3 minutes');
$$;

comment on function public.provider_is_live(boolean, timestamptz) is
  'True when provider toggled online and heartbeated within the last 3 minutes.';

grant execute on function public.provider_is_live(boolean, timestamptz)
  to anon, authenticated, service_role;

-- One-shot cleanup of abandoned online flags.
update public.provider_details
set is_online = false
where is_online = true
  and (
    last_online_at is null
    or last_online_at < (now() - interval '3 minutes')
  );

-- Used-capacity supply must require live presence (not just skill available_now).
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
    and o.status in (
      'pending',
      'offered',
      'assigned',
      'en_route',
      'arrived',
      'in_progress'
    )
    and o.created_at >= (now() - interval '30 minutes')
    and o.customer_lat is not null
    and o.customer_lng is not null
    and public.resolve_pricing_area_id(o.customer_lat, o.customer_lng) = p_area_id;

  select count(distinct pd.id) into v_online_providers
  from public.provider_details pd
  inner join public.provider_skills ps on ps.provider_id = pd.id
  where ps.service_id = p_service_id
    and ps.is_active = true
    and ps.available_now = true
    and pd.lat is not null
    and pd.lng is not null
    and public.provider_is_live(pd.is_online, pd.last_online_at)
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
  'Used capacity %: active bookings / live online providers (fresh heartbeat) per area+service.';

grant execute on function public.compute_used_capacity(text, text)
  to anon, authenticated, service_role;

-- Matching pool also requires a fresh heartbeat.
create or replace function public.match_providers(
  p_mode_id text,
  p_target_id text,
  p_category_id text,
  p_service_id text,
  p_service_mode_id text,
  p_customer_lat double precision,
  p_customer_lng double precision,
  p_scheduled_at timestamp with time zone default null,
  p_max_distance_km double precision default 10.0,
  p_min_rating double precision default 2.0,
  p_performance_tier text default null
)
returns table (
  provider_id uuid,
  distance_km double precision,
  service_rating double precision,
  reason_codes text[],
  is_available boolean,
  is_in_cooldown boolean
)
language sql
security definer
set search_path to 'public'
as $function$
with req as (
  select
    p_mode_id as mode_id,
    p_target_id as target_id,
    p_category_id as category_id,
    p_service_id as service_id,
    p_service_mode_id as service_mode_id,
    p_customer_lat as customer_lat,
    p_customer_lng as customer_lng,
    p_scheduled_at as scheduled_at,
    coalesce(p_max_distance_km, 10.0) as max_distance_km,
    coalesce(p_min_rating, 2.0) as min_rating,
    nullif(lower(trim(coalesce(p_performance_tier, ''))), '') as performance_tier,
    (clock_timestamp() - interval '5 minutes') as winner_deprioritize_cutoff
),
strict_candidates as (
  select distinct ps.provider_id
  from public.provider_skills ps
  join req r on true
  where ps.service_id = r.service_id
    and coalesce(ps.is_active, true) = true
    and coalesce(ps.available_now, true) = true
    and (ps.mode_id is null or ps.mode_id = r.mode_id)
    and (ps.target_id is null or ps.target_id = r.target_id)
    and (ps.category_id is null or ps.category_id = r.category_id)
    and (
      ps.service_mode_id is null
      or ps.service_mode_id = 'both'
      or r.service_mode_id = 'both'
      or ps.service_mode_id = r.service_mode_id
    )
),
online_candidates as (
  select sc.provider_id
  from strict_candidates sc
  join public.provider_details pd on pd.id = sc.provider_id
  where public.provider_is_live(pd.is_online, pd.last_online_at)
    and (
      (select performance_tier from req) is null
      or coalesce(
          nullif(lower(trim(pd.dispatch_performance_tier)), ''),
          'gold'
        ) = (select performance_tier from req)
    )
),
provider_points as (
  select
    oc.provider_id,
    pd.lat::double precision as provider_lat,
    pd.lng::double precision as provider_lng
  from online_candidates oc
  join public.provider_details pd on pd.id = oc.provider_id
),
distance_candidates as (
  select
    pp.provider_id,
    case
      when pp.provider_lat is not null and pp.provider_lng is not null then (
        6371.0 * acos(
          least(
            1.0,
            greatest(
              -1.0,
              cos(radians(r.customer_lat)) * cos(radians(pp.provider_lat)) *
              cos(radians(pp.provider_lng) - radians(r.customer_lng)) +
              sin(radians(r.customer_lat)) * sin(radians(pp.provider_lat))
            )
          )
        )
      )::double precision
      when r.service_mode_id in ('provider', 'both') then 0.0::double precision
      else null::double precision
    end as distance_km
  from provider_points pp
  join req r on true
  where
    (pp.provider_lat is not null and pp.provider_lng is not null)
    or r.service_mode_id in ('provider', 'both')
),
with_ratings as (
  select
    dc.provider_id,
    dc.distance_km,
    coalesce(max(ps.competence_rating)::double precision, 0.0) as service_rating
  from distance_candidates dc
  join req r on true
  left join public.provider_skills ps
    on ps.provider_id = dc.provider_id
   and ps.service_id = r.service_id
   and coalesce(ps.is_active, true) = true
   and coalesce(ps.available_now, true) = true
   and (ps.mode_id is null or ps.mode_id = r.mode_id)
   and (ps.target_id is null or ps.target_id = r.target_id)
   and (ps.category_id is null or ps.category_id = r.category_id)
   and (
     ps.service_mode_id is null
     or ps.service_mode_id = 'both'
     or r.service_mode_id = 'both'
     or ps.service_mode_id = r.service_mode_id
   )
  where dc.distance_km is not null
    and dc.distance_km <= r.max_distance_km
  group by dc.provider_id, dc.distance_km
),
available_candidates as (
  select wr.*
  from with_ratings wr
  join req r on true
  where wr.service_rating >= r.min_rating
    and not exists (
      select 1
      from public.orders o
      left join public.services s2 on s2.id = o.service_id
      where o.provider_id = wr.provider_id
        and (
          o.status in ('assigned', 'en_route')
          or (
            o.status = 'in_progress'
            and o.ready_for_next_request_at is null
          )
        )
        and (
          r.scheduled_at is null
          or
          (
            r.scheduled_at is not null
            and (
              coalesce(
                o.scheduled_at,
                o.started_at,
                o.accepted_at,
                o.created_at
              )
            ) < (
              r.scheduled_at + make_interval(mins => greatest(coalesce((select duration_minutes from public.services where id = r.service_id), 60), 1))
            )
            and
            (
              r.scheduled_at
            ) < (
              coalesce(
                o.scheduled_at,
                o.started_at,
                o.accepted_at,
                o.created_at
              ) + make_interval(mins => greatest(coalesce(s2.duration_minutes, 60), 1))
            )
          )
        )
    )
),
with_cooldown as (
  select
    ac.*,
    (
      exists (
        select 1
        from public.orders o
        join req r on true
        where o.provider_id = ac.provider_id
          and o.completed_at is not null
          and o.completed_at >= r.winner_deprioritize_cutoff
      )
      or exists (
        select 1
        from public.orders o
        join req r on true
        where o.provider_id = ac.provider_id
          and o.accepted_at is not null
          and o.accepted_at >= r.winner_deprioritize_cutoff
          and o.status in ('assigned', 'en_route', 'in_progress', 'completed')
      )
    ) as is_in_cooldown
  from available_candidates ac
)
select
  wc.provider_id,
  round(wc.distance_km::numeric, 3)::double precision as distance_km,
  wc.service_rating,
  array[]::text[] as reason_codes,
  true as is_available,
  wc.is_in_cooldown
from with_cooldown wc
order by wc.is_in_cooldown asc, wc.distance_km asc, wc.service_rating desc;
$function$;
