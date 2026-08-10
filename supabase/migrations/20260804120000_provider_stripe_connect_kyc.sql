-- Stripe Connect KYC gate for providers.
-- Online / dispatch require stripe_payouts_enabled + admin_approved.
-- provider_verifications.status is synced from Connect webhooks (no doc upload).

alter table public.provider_details
  add column if not exists stripe_charges_enabled boolean not null default false,
  add column if not exists stripe_payouts_enabled boolean not null default false,
  add column if not exists admin_approved boolean not null default false;

comment on column public.provider_details.stripe_charges_enabled is
  'Stripe Connect account.charges_enabled (synced via webhook).';
comment on column public.provider_details.stripe_payouts_enabled is
  'Stripe Connect account.payouts_enabled — required to go online / receive offers.';
comment on column public.provider_details.admin_approved is
  'First-cohort FreshUp admin gate on top of Stripe Connect readiness.';

-- Keep stripe_onboarded aligned with both capability flags.
update public.provider_details
set stripe_onboarded = (coalesce(stripe_charges_enabled, false) and coalesce(stripe_payouts_enabled, false))
where true;

alter table public.provider_verifications
  add column if not exists source text;

alter table public.provider_verifications
  drop constraint if exists provider_verifications_source_check;

alter table public.provider_verifications
  add constraint provider_verifications_source_check
  check (source is null or source = any (array['stripe', 'admin']::text[]));

-- One verification row per provider (upsert target for Connect webhook).
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'provider_verifications_provider_id_key'
  ) then
    -- Deduplicate before unique index if needed.
    delete from public.provider_verifications pv
    using public.provider_verifications keep
    where pv.provider_id = keep.provider_id
      and pv.id > keep.id;

    alter table public.provider_verifications
      add constraint provider_verifications_provider_id_key unique (provider_id);
  end if;
end $$;

-- Providers may read their own row; writes only via service role (webhook / admin API).
drop policy if exists "Providers manage own verifications" on public.provider_verifications;

drop policy if exists "Providers read own verifications" on public.provider_verifications;
create policy "Providers read own verifications"
  on public.provider_verifications
  for select
  using (provider_id = auth.uid());

-- Helper used by match_providers + app APIs.
create or replace function public.provider_is_dispatch_eligible(
  p_stripe_payouts_enabled boolean,
  p_admin_approved boolean
) returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(p_stripe_payouts_enabled, false)
     and coalesce(p_admin_approved, false);
$$;

comment on function public.provider_is_dispatch_eligible(boolean, boolean) is
  'True when provider passed Stripe Connect payouts + FreshUp admin approve.';

grant execute on function public.provider_is_dispatch_eligible(boolean, boolean)
  to anon, authenticated, service_role;

-- Patch match_providers: require Connect payouts + admin approve.
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
    and public.provider_is_dispatch_eligible(
      pd.stripe_payouts_enabled,
      pd.admin_approved
    )
    and public.provider_delivery_modes_allow_service_mode(
      pd.delivery_modes,
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
