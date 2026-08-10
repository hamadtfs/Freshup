-- Fix idle short-circuit: orders.status is enum order_status, not text.
-- The previous short-circuit compared enum = text[] and failed every tick.

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
  v_has_open boolean;
  v_default_edge_url text :=
    'https://dptltpvmqinzjrgjefoe.supabase.co/functions/v1/dispatch-tick-cron';
begin
  -- Match dispatchTick candidate filter (unassigned pending/offered, not past deadline).
  select exists (
    select 1
    from public.orders o
    where o.provider_id is null
      and o.status::text = any (array['pending', 'offered'])
      and (
        o.dispatch_deadline_at is null
        or o.dispatch_deadline_at > now()
      )
  )
  into v_has_open;

  if not coalesce(v_has_open, false) then
    return null;
  end if;

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
  'pg_cron trigger: skips HTTP when no pending/offered unassigned orders; otherwise POSTs dispatch-tick-cron with x-dispatch-secret.';
