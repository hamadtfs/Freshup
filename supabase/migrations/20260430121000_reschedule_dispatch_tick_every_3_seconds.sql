-- Architecture §4.3 requires sub-waves at 0s / 3s / 6s within each batch.
-- The dispatch worker must run at least every 3 seconds (offer TTL matches).

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists "supabase_vault" with schema vault;

do $$
declare
  v_old_job_id bigint;
  v_new_job_id bigint;
begin
  select jobid
  into v_old_job_id
  from cron.job
  where jobname = 'dispatch-tick-cron-every-15-seconds'
  limit 1;

  if v_old_job_id is not null then
    perform cron.unschedule(v_old_job_id);
  end if;

  select jobid
  into v_new_job_id
  from cron.job
  where jobname = 'dispatch-tick-cron-every-3-seconds'
  limit 1;

  if v_new_job_id is not null then
    perform cron.unschedule(v_new_job_id);
  end if;

  perform cron.schedule(
    'dispatch-tick-cron-every-3-seconds',
    '3 seconds',
    $cron$
      select public.invoke_dispatch_tick_cron();
    $cron$
  );
end $$;
