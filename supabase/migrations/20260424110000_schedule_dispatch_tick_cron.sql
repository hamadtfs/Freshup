-- Milestone 3: schedule dispatch tick via Supabase pg_cron + pg_net.
--
-- This creates a database cron job that invokes the Edge Function `dispatch-tick-cron`
-- every minute. The Edge Function then calls your app's `/api/orders/dispatch_tick`.
--
-- Notes:
-- - Supabase Edge Function schedules configured in the Dashboard are NOT stored in Postgres,
--   so they cannot be created via SQL migrations.
-- - This migration uses pg_cron + pg_net instead (which *is* migratable).
-- - The Authorization bearer uses the anon key (publishable) to satisfy JWT verification.
--
-- If you later configure scheduling in the Dashboard instead, you should remove/unschedule
-- this job to avoid double-triggering.

-- Ensure required extensions exist.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

do $$
declare
  existing_job_id int;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'dispatch-tick-cron-every-minute'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'dispatch-tick-cron-every-minute',
    '* * * * *',
    $cmd$
      select
        net.http_post(
          url := 'https://dptltpvmqinzjrgjefoe.supabase.co/functions/v1/dispatch-tick-cron',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer sb_publishable_DgxG0GiuTgJ9q1bl9-JvuQ_tOkThbVx'
          ),
          body := '{}'::jsonb
        );
    $cmd$
  );
end $$;

