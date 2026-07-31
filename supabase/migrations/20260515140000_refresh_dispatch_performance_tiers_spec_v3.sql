-- Pricing & Tier System spec §3: received denominator, wave-aligned response points,
-- equal-weight final score. Replaces refresh_dispatch_performance_tiers() body only.

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
          when m.received < 3 then 'gold'
          when m.final_score >= 0.70 then 'gold'
          when m.final_score >= 0.50 then 'silver'
          else 'bronze'
        end as tier
      from metrics m
    )
    select provider_id, tier from rated
  ) r
  where pd.id = r.provider_id;
end;
$$;

comment on function public.refresh_dispatch_performance_tiers() is
  'Spec §3: accept/completion/response_speed over offers received; score = average of three; tiers 70/50.';
