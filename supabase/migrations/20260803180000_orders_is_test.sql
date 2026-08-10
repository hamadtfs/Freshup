-- orders.is_test: mark solo/self-test bookings so they do not pollute
-- used_capacity, demand-zone active_bookings, or dispatch performance tiers.
--
-- Confirmed column name: public.orders.is_test
-- Backfill: the 46 historical self-assignment rows (customer_id = provider_id).

alter table public.orders
  add column if not exists is_test boolean not null default false;

comment on column public.orders.is_test is
  'True for test / solo bookings (e.g. self-assignment). Excluded from capacity, demand active_bookings, and performance tier scoring.';

create index if not exists idx_orders_is_test_false_created
  on public.orders (created_at)
  where is_test = false;

-- Sticky auto-flag: self-assignment (customer_id = provider_id) is always test.
create or replace function public.orders_auto_flag_self_test()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.is_test := coalesce(new.is_test, false)
    or (
      new.provider_id is not null
      and new.customer_id = new.provider_id
    );
  return new;
end;
$$;

drop trigger if exists trg_orders_auto_flag_self_test on public.orders;
create trigger trg_orders_auto_flag_self_test
  before insert or update of provider_id, customer_id, is_test
  on public.orders
  for each row
  execute function public.orders_auto_flag_self_test();

-- Backfill the known self-test cohort (Munib: 46 rows).
update public.orders
set is_test = true
where provider_id is not null
  and customer_id = provider_id
  and is_test = false;

-- ---------------------------------------------------------------------------
-- Capacity: exclude is_test from active_bookings
-- ---------------------------------------------------------------------------
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
    and coalesce(o.is_test, false) = false
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
    and coalesce(pd.is_online, false) = true
    and pd.last_online_at is not null
    and pd.last_online_at > (now() - interval '3 minutes')
    and public.resolve_pricing_area_id(pd.lat, pd.lng) = p_area_id;

  if v_online_providers = 0 then
    if v_active_bookings > 0 then
      return greatest(100, v_active_bookings * 100);
    end if;
    return 0;
  end if;

  return round(
    (v_active_bookings::numeric / v_online_providers::numeric) * 100,
    2
  );
end;
$$;

comment on function public.compute_used_capacity(text, text) is
  'Used capacity %: non-test bookings / live online providers. Bookings with 0 providers ⇒ saturated (≥100%).';

grant execute on function public.compute_used_capacity(text, text)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Performance tiers: exclude is_test orders (and their offers)
-- ---------------------------------------------------------------------------
create or replace function public.refresh_dispatch_performance_tiers()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.provider_details pd
  set dispatch_performance_tier = r.tier
  from (
    with cutoff as (
      select (now() - interval '30 days') as ts
    ),
    offer_agg as (
      select
        oo.provider_id,
        count(*)::numeric as received,
        count(*) filter (where oo.status = 'accepted')::numeric as accepted,
        sum(
          case
            when oo.responded_at is null then 0::numeric
            when extract(epoch from (oo.responded_at - oo.created_at)) <= 3 then 1::numeric
            when extract(epoch from (oo.responded_at - oo.created_at)) <= 6 then 0.5::numeric
            when extract(epoch from (oo.responded_at - oo.created_at)) <= 9 then 0.25::numeric
            else 0::numeric
          end
        ) as speed_points
      from public.order_offers oo
      inner join public.orders o on o.id = oo.order_id
      cross join cutoff c
      where oo.created_at >= c.ts
        and coalesce(o.is_test, false) = false
      group by oo.provider_id
    ),
    completed_s as (
      select
        o.provider_id,
        count(*)::numeric as completed
      from public.orders o
      cross join cutoff c
      where o.provider_id is not null
        and coalesce(o.is_test, false) = false
        and o.status = 'completed'
        and coalesce(o.completed_at, o.accepted_at) >= c.ts
      group by o.provider_id
    ),
    scored as (
      select
        pd.id as provider_id,
        pd.created_at as provider_created_at,
        coalesce(oa.received, 0::numeric) as received,
        coalesce(oa.accepted, 0::numeric) as accepted,
        coalesce(cs.completed, 0::numeric) as completed,
        coalesce(oa.speed_points, 0::numeric) as speed_points
      from public.provider_details pd
      left join offer_agg oa on oa.provider_id = pd.id
      left join completed_s cs on cs.provider_id = pd.id
    ),
    metrics as (
      select
        s.provider_id,
        s.provider_created_at,
        s.received,
        case
          when s.received > 0 then s.accepted / s.received
          else 0::numeric
        end as accept_rate,
        case
          when s.received > 0 then s.completed / s.received
          else 0::numeric
        end as completion_rate,
        case
          when s.received > 0 then s.speed_points / s.received
          else 0::numeric
        end as response_speed,
        case
          when s.received > 0 then
            (s.accepted / s.received
              + s.completed / s.received
              + s.speed_points / s.received) / 3::numeric
          else 0::numeric
        end as final_score
      from scored s
    ),
    rated as (
      select
        m.provider_id,
        case
          when m.received < 3 then 'silver'
          when m.final_score >= 0.70 then 'gold'
          when m.final_score >= 0.50 then 'silver'
          else 'bronze'
        end as raw_tier,
        m.provider_created_at
      from metrics m
    ),
    with_grace as (
      select
        r.provider_id,
        case
          when r.raw_tier = 'bronze'
            and r.provider_created_at > (now() - interval '30 days')
          then 'silver'
          else r.raw_tier
        end as tier
      from rated r
    )
    select provider_id, tier from with_grace
  ) r
  where pd.id = r.provider_id;
end;
$$;

comment on function public.refresh_dispatch_performance_tiers() is
  'Spec §3 + §3.4: score tiers 70/50; excludes orders.is_test; insufficient sample → Silver; 30-day grace floor Silver.';
