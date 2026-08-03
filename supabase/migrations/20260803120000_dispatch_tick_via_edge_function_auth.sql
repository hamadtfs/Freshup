-- Route pg_cron dispatch through the dispatch-tick-cron Edge Function
-- (not directly at Next.js), and require x-dispatch-secret on that hop.
--
-- Flow:
--   pg_cron → invoke_dispatch_tick_cron()
--         → POST /functions/v1/dispatch-tick-cron  (header: x-dispatch-secret)
--         → Edge Function → POST {APP_BASE_URL}/api/orders/dispatch_tick
--
-- Vault secrets still required:
--   dispatch_tick_secret       — shared with Next.js DISPATCH_TICK_SECRET
--   dispatch_tick_app_base_url — kept for rollback / ops visibility (Edge
--                                Function uses APP_BASE_URL secret instead)
-- Optional:
--   dispatch_tick_edge_function_url — override Edge Function URL
--
-- After applying: redeploy Edge Function with inbound auth:
--   supabase functions deploy dispatch-tick-cron --no-verify-jwt
-- Set Edge Function secrets APP_BASE_URL + DISPATCH_TICK_SECRET.

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
  v_dispatch_secret text;
  v_edge_url text;
  v_request_id bigint;
  v_default_edge_url text :=
    'https://dptltpvmqinzjrgjefoe.supabase.co/functions/v1/dispatch-tick-cron';
begin
  select decrypted_secret
  into v_dispatch_secret
  from vault.decrypted_secrets
  where name = 'dispatch_tick_secret'
  limit 1;

  select decrypted_secret
  into v_edge_url
  from vault.decrypted_secrets
  where name = 'dispatch_tick_edge_function_url'
  limit 1;

  if coalesce(v_edge_url, '') = '' then
    v_edge_url := v_default_edge_url;
  end if;

  if coalesce(v_dispatch_secret, '') = '' then
    raise notice
      'Missing Vault secret dispatch_tick_secret for dispatch cron; skipping dispatch tick invocation';
    return null;
  end if;

  select net.http_post(
    url := regexp_replace(v_edge_url, '/+$', ''),
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
  'pg_cron trigger: POST dispatch-tick-cron Edge Function with x-dispatch-secret; Edge Function then calls Next.js /api/orders/dispatch_tick.';

-- Keep the 3-second schedule; ensure legacy jobs that hit Next.js/minute paths are gone.
do $$
declare
  v_job_id bigint;
  r record;
begin
  for r in
    select jobid, jobname
    from cron.job
    where jobname in (
      'dispatch-tick-cron-every-minute',
      'dispatch-tick-cron-every-15-seconds',
      'dispatch-tick-cron-every-1-minute'
    )
  loop
    perform cron.unschedule(r.jobid);
  end loop;

  select jobid
  into v_job_id
  from cron.job
  where jobname = 'dispatch-tick-cron-every-3-seconds'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'dispatch-tick-cron-every-3-seconds',
    '3 seconds',
    $cron$
      select public.invoke_dispatch_tick_cron();
    $cron$
  );
end $$;
