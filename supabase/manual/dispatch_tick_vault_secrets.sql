-- One-off helper for provisioning dispatch cron Vault secrets + notes for
-- Edge Function secrets. Do not commit real secret values into versioned migrations.
--
-- Architecture (Munib 2026-08):
--   pg_cron → invoke_dispatch_tick_cron() → Edge Function dispatch-tick-cron
--            → {APP_BASE_URL}/api/orders/dispatch_tick
--
-- Do NOT schedule dispatch on Vercel Cron.
--
-- Usage:
-- 1. Replace the placeholder values below (app URL + shared secret).
-- 2. Run this file in the Supabase SQL editor.
-- 3. Apply migration 20260803120000_dispatch_tick_via_edge_function_auth.sql
-- 4. Set Edge Function secrets (Dashboard → Edge Functions → Secrets):
--      APP_BASE_URL         = same public Next.js URL as below (no trailing slash preferred)
--      DISPATCH_TICK_SECRET = same as dispatch_tick_secret below
-- 5. Deploy: supabase functions deploy dispatch-tick-cron --no-verify-jwt
--
-- When the temporary Vercel host moves, update APP_BASE_URL (Edge) and
-- dispatch_tick_app_base_url (Vault) to the new URL; rotate secrets after move.

create extension if not exists "supabase_vault" with schema vault;

do $$
declare
  v_app_base_url text := '__REPLACE_WITH_PUBLIC_APP_BASE_URL__';
  v_dispatch_secret text := '__REPLACE_WITH_DISPATCH_TICK_SECRET__';
  v_app_secret_id uuid;
  v_tick_secret_id uuid;
begin
  if v_app_base_url = '__REPLACE_WITH_PUBLIC_APP_BASE_URL__' then
    raise exception
      'Replace __REPLACE_WITH_PUBLIC_APP_BASE_URL__ before running this script';
  end if;

  if v_dispatch_secret = '__REPLACE_WITH_DISPATCH_TICK_SECRET__' then
    raise exception
      'Replace __REPLACE_WITH_DISPATCH_TICK_SECRET__ before running this script';
  end if;

  select id
  into v_app_secret_id
  from vault.decrypted_secrets
  where name = 'dispatch_tick_app_base_url'
  limit 1;

  if v_app_secret_id is null then
    perform vault.create_secret(
      v_app_base_url,
      'dispatch_tick_app_base_url',
      'Public base URL for dispatch tick (ops / rollback; Edge uses APP_BASE_URL)'
    );
  else
    perform vault.update_secret(
      v_app_secret_id,
      v_app_base_url,
      'dispatch_tick_app_base_url',
      'Public base URL for dispatch tick (ops / rollback; Edge uses APP_BASE_URL)'
    );
  end if;

  select id
  into v_tick_secret_id
  from vault.decrypted_secrets
  where name = 'dispatch_tick_secret'
  limit 1;

  if v_tick_secret_id is null then
    perform vault.create_secret(
      v_dispatch_secret,
      'dispatch_tick_secret',
      'Shared secret for dispatch-tick-cron inbound + /api/orders/dispatch_tick'
    );
  else
    perform vault.update_secret(
      v_tick_secret_id,
      v_dispatch_secret,
      'dispatch_tick_secret',
      'Shared secret for dispatch-tick-cron inbound + /api/orders/dispatch_tick'
    );
  end if;
end $$;
