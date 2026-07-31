-- Reduce Supabase capacity consumption.
--
-- Background:
--   The 3-second dispatch tick cron job runs ~28,800 times/day,
--   ~864,000 times/month. Combined with two legacy dispatch cron
--   jobs (every-15-seconds, every-minute) this dominates the project's
--   monthly invocation budget.
--
-- This migration:
--   1) Reschedules `dispatch-tick-cron-every-3-seconds` to run every
--      60 seconds (renaming it accordingly so the schedule and the
--      job name stay in sync).
--   2) Unschedules the legacy `dispatch-tick-cron-every-15-seconds`
--      and `dispatch-tick-cron-every-minute` jobs (the new minute
--      cadence replaces both of them).
--   3) Leaves `cancel_stale_unassigned_orders_every_minute` and the
--      hourly tier refresh untouched.
--
-- Trade-off vs spec §4.3 (sub-waves at 0s/3s/6s):
--   - The dispatch loop itself (`lib/orders/dispatchTick.ts`) drives
--     the 3 s tier waves *within a single tick*; the cron only wakes
--     it up to scan for new orders. Going from 3 s to 60 s adds at
--     most ~60 s of wait time before the *first* offer goes out, but
--     the in-tick wave timing is unchanged. We will revisit if the
--     latency target tightens.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

do $$
declare
  v_legacy_15s_id   bigint;
  v_legacy_min_id   bigint;
  v_three_sec_id    bigint;
  v_one_min_id      bigint;
begin
  -- 1) Unschedule the legacy 15-second job (superseded by the
  --    every-3-seconds job months ago, but still scheduled in some
  --    environments).
  select jobid
  into v_legacy_15s_id
  from cron.job
  where jobname = 'dispatch-tick-cron-every-15-seconds'
  limit 1;
  if v_legacy_15s_id is not null then
    perform cron.unschedule(v_legacy_15s_id);
  end if;

  -- 2) Unschedule the original every-minute job. The new
  --    every-1-minute job created below is its functional successor
  --    but uses the in-DB `invoke_dispatch_tick_cron()` pathway
  --    rather than the HTTP/edge-function loop, which keeps
  --    invocation accounting on the Postgres side only.
  select jobid
  into v_legacy_min_id
  from cron.job
  where jobname = 'dispatch-tick-cron-every-minute'
  limit 1;
  if v_legacy_min_id is not null then
    perform cron.unschedule(v_legacy_min_id);
  end if;

  -- 3) Unschedule the existing every-3-seconds job. This is the
  --    primary capacity drain.
  select jobid
  into v_three_sec_id
  from cron.job
  where jobname = 'dispatch-tick-cron-every-3-seconds'
  limit 1;
  if v_three_sec_id is not null then
    perform cron.unschedule(v_three_sec_id);
  end if;

  -- Make sure no stale duplicate of the new job exists before we
  -- create it (idempotent for re-runs).
  select jobid
  into v_one_min_id
  from cron.job
  where jobname = 'dispatch-tick-cron-every-1-minute'
  limit 1;
  if v_one_min_id is not null then
    perform cron.unschedule(v_one_min_id);
  end if;

  -- 4) Schedule the slimmed-down 1-minute job.
  --
  --    pg_cron rejects the natural-language form '1 minute' (seen on
  --    Supabase Postgres 15). Use the standard 5-field cron expression
  --    '* * * * *' which means "every minute, on the minute".
  perform cron.schedule(
    'dispatch-tick-cron-every-1-minute',
    '* * * * *',
    $cron$
      select public.invoke_dispatch_tick_cron();
    $cron$
  );
end $$;
