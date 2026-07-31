-- Pricing & Tier System spec §3.4 — New Provider Policy:
-- • Brand-new providers start as Silver (not Bronze).
-- • 30-day grace: cannot drop below Silver after signup.

ALTER TABLE public.provider_details
  ALTER COLUMN dispatch_performance_tier SET DEFAULT 'silver';

COMMENT ON COLUMN public.provider_details.dispatch_performance_tier IS
  '30-day performance tier (gold|silver|bronze). New providers default Silver (§3.4); grace floor Silver for 30 days after created_at.';

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
      cross join cutoff c
      where oo.created_at >= c.ts
      group by oo.provider_id
    ),
    completed_s as (
      select
        o.provider_id,
        count(*)::numeric as completed
      from public.orders o
      cross join cutoff c
      where o.provider_id is not null
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
  'Spec §3 + §3.4: score tiers 70/50; insufficient sample → Silver; 30-day grace floor Silver.';
