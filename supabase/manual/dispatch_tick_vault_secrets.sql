-- One-off helper for provisioning dispatch cron Vault secrets.
-- Do not commit real secret values into versioned migrations.
--
-- Usage:
-- 1. Replace the two placeholder values below.
-- 2. Run this file in the Supabase SQL editor.
-- 3. Re-run `supabase db push` if the cron migration was previously blocked.

create extension if not exists "supabase_vault" with schema vault;

do $$
declare
  v_app_base_url text := 'https://03ca-2400-adc5-1b4-8a00-7863-b2fc-ee6b-c17b.ngrok-free.app/';
  v_dispatch_secret text := 'dispatch_tick_local_2026_7tN3mQ9kW2pL6aR1xV4c';
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
      'Public base URL for dispatch tick cron'
    );
  else
    perform vault.update_secret(
      v_app_secret_id,
      v_app_base_url,
      'dispatch_tick_app_base_url',
      'Public base URL for dispatch tick cron'
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
      'Shared secret for /api/orders/dispatch_tick'
    );
  else
    perform vault.update_secret(
      v_tick_secret_id,
      v_dispatch_secret,
      'dispatch_tick_secret',
      'Shared secret for /api/orders/dispatch_tick'
    );
  end if;
end $$;
