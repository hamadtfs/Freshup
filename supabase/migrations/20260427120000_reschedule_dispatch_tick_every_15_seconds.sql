-- Milestone 3: align dispatch tick cadence with the 15 second offer window.
--
-- This replaces the legacy every-minute schedule with an every-15-seconds job that
-- calls the app's internal `/api/orders/dispatch_tick` endpoint directly.
--
-- Required Vault secrets:
-- - dispatch_tick_app_base_url : public app base URL (for example https://your-app.com)
-- - dispatch_tick_secret       : shared secret that matches Next.js DISPATCH_TICK_SECRET
--
-- Setup example:
--   select vault.create_secret('https://your-app.com', 'dispatch_tick_app_base_url');
--   select vault.create_secret('your-shared-secret', 'dispatch_tick_secret');

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists "supabase_vault" with schema vault;

create or replace function public.invoke_dispatch_tick_cron()
returns bigint
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_app_base_url text;
  v_dispatch_secret text;
  v_request_id bigint;
begin
  select decrypted_secret
  into v_app_base_url
  from vault.decrypted_secrets
  where name = 'dispatch_tick_app_base_url'
  limit 1;

  select decrypted_secret
  into v_dispatch_secret
  from vault.decrypted_secrets
  where name = 'dispatch_tick_secret'
  limit 1;

  if coalesce(v_app_base_url, '') = '' then
    raise notice
      'Missing Vault secret dispatch_tick_app_base_url for dispatch cron; skipping dispatch tick invocation';
    return null;
  end if;

  if coalesce(v_dispatch_secret, '') = '' then
    raise notice
      'Missing Vault secret dispatch_tick_secret for dispatch cron; skipping dispatch tick invocation';
    return null;
  end if;

  select net.http_post(
    url := regexp_replace(v_app_base_url, '/+$', '') || '/api/orders/dispatch_tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-secret', v_dispatch_secret
    ),
    body := '{}'::jsonb
  )
  into v_request_id;

  return v_request_id;
end;
$$;

comment on function public.invoke_dispatch_tick_cron() is
  'Triggers the internal dispatch tick endpoint from pg_cron using Vault-backed config.';

do $$
declare
  v_old_job_id bigint;
  v_new_job_id bigint;
begin
  select jobid
  into v_old_job_id
  from cron.job
  where jobname = 'dispatch-tick-cron-every-minute'
  limit 1;

  if v_old_job_id is not null then
    perform cron.unschedule(v_old_job_id);
  end if;

  select jobid
  into v_new_job_id
  from cron.job
  where jobname = 'dispatch-tick-cron-every-15-seconds'
  limit 1;

  if v_new_job_id is not null then
    perform cron.unschedule(v_new_job_id);
  end if;

  perform cron.schedule(
    'dispatch-tick-cron-every-15-seconds',
    '15 seconds',
    $cron$
      select public.invoke_dispatch_tick_cron();
    $cron$
  );
end $$;
