-- Prevent pg_net / pg_cron log tables from growing without bound.
--
-- Background:
--   dispatch-tick-cron-every-3-seconds calls net.http_post ~28,800×/day.
--   Each call writes to net._http_response; each cron run writes to
--   cron.job_run_details. Together these grew the DB from ~25 MB to
--   ~2 GB until truncated manually.
--
-- This migration:
--   1) Adds public.cleanup_extension_http_and_cron_logs() which deletes
--      rows older than 48 hours from both tables (batched).
--   2) Schedules it daily at 03:15 UTC via pg_cron.
--
-- Note: pg_net's built-in TTL (default ~6h) is not always enough when
-- the table is already large / worker cleanup falls behind — explicit
-- retention is the hard floor.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

create or replace function public.cleanup_extension_http_and_cron_logs(
  p_retention interval default interval '48 hours',
  p_batch_size integer default 5000
)
returns jsonb
language plpgsql
security definer
set search_path = public, net, cron, pg_temp
as $$
declare
  v_cut timestamptz := now() - p_retention;
  v_http_deleted bigint := 0;
  v_cron_deleted bigint := 0;
  v_n integer;
  v_batch integer := greatest(coalesce(p_batch_size, 5000), 100);
begin
  -- net._http_response (pg_net)
  loop
    with doomed as (
      select ctid
      from net._http_response
      where created < v_cut
      order by created
      limit v_batch
    ),
    deleted as (
      delete from net._http_response r
      using doomed d
      where r.ctid = d.ctid
      returning 1
    )
    select count(*)::integer into v_n from deleted;
    v_http_deleted := v_http_deleted + coalesce(v_n, 0);
    exit when coalesce(v_n, 0) = 0;
  end loop;

  -- cron.job_run_details (pg_cron) — no automatic cleanup
  loop
    with doomed as (
      select ctid
      from cron.job_run_details
      where coalesce(end_time, start_time) < v_cut
      order by coalesce(end_time, start_time)
      limit v_batch
    ),
    deleted as (
      delete from cron.job_run_details r
      using doomed d
      where r.ctid = d.ctid
      returning 1
    )
    select count(*)::integer into v_n from deleted;
    v_cron_deleted := v_cron_deleted + coalesce(v_n, 0);
    exit when coalesce(v_n, 0) = 0;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'retention', p_retention::text,
    'cut_before', v_cut,
    'net_http_response_deleted', v_http_deleted,
    'cron_job_run_details_deleted', v_cron_deleted
  );
end;
$$;

comment on function public.cleanup_extension_http_and_cron_logs(interval, integer) is
  'Deletes net._http_response and cron.job_run_details rows older than retention (default 48h). Scheduled daily.';

revoke all on function public.cleanup_extension_http_and_cron_logs(interval, integer) from public;
grant execute on function public.cleanup_extension_http_and_cron_logs(interval, integer) to postgres;

do $$
declare
  v_old_job_id bigint;
begin
  select jobid
  into v_old_job_id
  from cron.job
  where jobname = 'cleanup-extension-http-and-cron-logs-daily'
  limit 1;

  if v_old_job_id is not null then
    perform cron.unschedule(v_old_job_id);
  end if;

  -- 03:15 UTC daily — offset from hour-boundary jobs (tier refresh at :00).
  perform cron.schedule(
    'cleanup-extension-http-and-cron-logs-daily',
    '15 3 * * *',
    $cron$
      select public.cleanup_extension_http_and_cron_logs(interval '48 hours');
    $cron$
  );
end $$;

-- Best-effort: shorten pg_net worker TTL if the GUC is available on this host.
-- Explicit daily cleanup above is the reliable floor regardless.
do $$
begin
  execute $guc$alter database postgres set "pg_net.ttl" = '2 hours'$guc$;
exception
  when others then
    raise notice
      'Could not set pg_net.ttl (host may not allow it): %',
      sqlerrm;
end $$;
