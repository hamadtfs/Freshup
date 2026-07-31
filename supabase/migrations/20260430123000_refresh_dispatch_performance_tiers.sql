-- M2-style performance tiers for Architecture §4.3 (Gold / Silver / Bronze).
-- Recomputes provider_details.dispatch_performance_tier from the last 30 days of:
--   - order_offers: accept vs decline + response time
--   - orders: completion of accepted jobs
--
-- Insufficient sample → gold (do not penalize new or quiet providers).
-- Schedule: hourly via pg_cron (adjust as needed).

create extension if not exists pg_cron with schema extensions;

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
    offer_s as (
      select
        oo.provider_id,
        count(*) filter (where oo.status = 'accepted')::numeric as acc,
        count(*) filter (where oo.status = 'declined')::numeric as dec,
        avg(
          extract(epoch from (oo.responded_at - oo.created_at))
        ) filter (
          where oo.responded_at is not null
            and oo.status in ('accepted', 'declined')
        ) as avg_resp_sec
      from public.order_offers oo
      cross join cutoff c
      where oo.created_at >= c.ts
      group by oo.provider_id
    ),
    job_s as (
      select
        o.provider_id,
        count(*)::numeric as jobs,
        count(*) filter (where o.status = 'completed')::numeric as done
      from public.orders o
      cross join cutoff c
      where o.provider_id is not null
        and o.accepted_at is not null
        and o.accepted_at >= c.ts
      group by o.provider_id
    ),
    scored as (
      select
        pd.id as provider_id,
        coalesce(os.acc, 0::numeric) as acc,
        coalesce(os.dec, 0::numeric) as dec,
        os.avg_resp_sec,
        coalesce(js.jobs, 0::numeric) as jobs,
        coalesce(js.done, 0::numeric) as done
      from public.provider_details pd
      left join offer_s os on os.provider_id = pd.id
      left join job_s js on js.provider_id = pd.id
    ),
    rated as (
      select
        s.provider_id,
        case
          when (s.acc + s.dec) < 3 and s.jobs < 2 then 'gold'
          else
            case
              when (
                0.35 * (case when s.acc + s.dec > 0 then s.acc / (s.acc + s.dec) else 0.5 end)
                + 0.35 * (case when s.jobs > 0 then s.done / s.jobs else 0.5 end)
                + 0.30 * greatest(
                  0::numeric,
                  least(
                    1::numeric,
                    1::numeric - least(1::numeric, coalesce(s.avg_resp_sec, 90::numeric) / 180::numeric)
                  )
                )
              ) >= 0.70 then 'gold'
              when (
                0.35 * (case when s.acc + s.dec > 0 then s.acc / (s.acc + s.dec) else 0.5 end)
                + 0.35 * (case when s.jobs > 0 then s.done / s.jobs else 0.5 end)
                + 0.30 * greatest(
                  0::numeric,
                  least(
                    1::numeric,
                    1::numeric - least(1::numeric, coalesce(s.avg_resp_sec, 90::numeric) / 180::numeric)
                  )
                )
              ) >= 0.42 then 'silver'
              else 'bronze'
            end
        end as tier
      from scored s
    )
    select provider_id, tier from rated
  ) r
  where pd.id = r.provider_id;
end;
$$;

comment on function public.refresh_dispatch_performance_tiers() is
  'Recomputes provider_details.dispatch_performance_tier from last-30-day offer + order stats (M2-style).';

revoke all on function public.refresh_dispatch_performance_tiers() from public;
grant execute on function public.refresh_dispatch_performance_tiers() to service_role;

-- Hourly refresh (standard cron: minute 0 of every hour).
do $$
declare
  v_old_job_id bigint;
begin
  select jobid
  into v_old_job_id
  from cron.job
  where jobname = 'refresh-dispatch-performance-tiers-hourly'
  limit 1;

  if v_old_job_id is not null then
    perform cron.unschedule(v_old_job_id);
  end if;

  perform cron.schedule(
    'refresh-dispatch-performance-tiers-hourly',
    '0 * * * *',
    $cron$
      select public.refresh_dispatch_performance_tiers();
    $cron$
  );
end $$;
