-- Separate "what I can do" (delivery_modes) from "what I'm accepting right now".
-- Providers with both capabilities must pick Delivery or At-provider in the UI;
-- only that accepting mode receives offers.

alter table public.provider_details
  add column if not exists accepting_delivery_mode text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'provider_details_accepting_delivery_mode_check'
  ) then
    alter table public.provider_details
      add constraint provider_details_accepting_delivery_mode_check
      check (
        accepting_delivery_mode is null
        or accepting_delivery_mode in ('home', 'at_provider', 'both', 'provider')
      );
  end if;
end $$;

comment on column public.provider_details.accepting_delivery_mode is
  'Currently accepting jobs: home | at_provider | both. Capabilities stay in delivery_modes. null = both (legacy).';

-- Ensure presence helper exists (also created in 20260731120000).
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

create or replace function public.provider_accepts_service_mode(
  p_accepting_delivery_mode text,
  p_service_mode_id text
) returns boolean
language sql
stable
set search_path = public
as $$
  select case
    when coalesce(nullif(lower(trim(p_accepting_delivery_mode)), ''), 'both') in ('both') then true
    when lower(trim(coalesce(p_service_mode_id, ''))) = 'home'
      and lower(trim(p_accepting_delivery_mode)) = 'home' then true
    when lower(trim(coalesce(p_service_mode_id, ''))) in ('provider', 'both')
      and lower(trim(p_accepting_delivery_mode)) in ('at_provider', 'provider') then true
    else false
  end;
$$;

comment on function public.provider_accepts_service_mode(text, text) is
  'True when provider accepting_delivery_mode allows this order service_mode_id.';

grant execute on function public.provider_accepts_service_mode(text, text)
  to anon, authenticated, service_role;

-- Matching must respect the live accepting mode (not only skill service_mode_id = both).
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
  join req r on true
  where public.provider_is_live(pd.is_online, pd.last_online_at)
    and public.provider_accepts_service_mode(
      pd.accepting_delivery_mode,
      r.service_mode_id
    )
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
