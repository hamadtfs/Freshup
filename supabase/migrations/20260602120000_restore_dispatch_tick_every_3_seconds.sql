-- Restore 3-second dispatch cron so tier waves fire at +0s / +3s / +6s (one wave per tick).
-- The 1-minute job bunches Gold+Silver+Bronze when dispatchTick used to catch up all due waves.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

do $$
declare
  v_one_min_id bigint;
  v_three_sec_id bigint;
begin
  select jobid
  into v_one_min_id
  from cron.job
  where jobname = 'dispatch-tick-cron-every-1-minute'
  limit 1;
  if v_one_min_id is not null then
    perform cron.unschedule(v_one_min_id);
  end if;

  select jobid
  into v_three_sec_id
  from cron.job
  where jobname = 'dispatch-tick-cron-every-3-seconds'
  limit 1;
  if v_three_sec_id is not null then
    perform cron.unschedule(v_three_sec_id);
  end if;

  perform cron.schedule(
    'dispatch-tick-cron-every-3-seconds',
    '3 seconds',
    $cron$
      select public.invoke_dispatch_tick_cron();
    $cron$
  );
end $$;
