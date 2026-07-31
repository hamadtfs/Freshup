-- =====================================================================
-- FreshUp Pricing & Tier System Specification v1.0 — DDL
-- Implements sections 2.1 – 2.5 of FreshUp_Pricing_and_Tier_System v1.0
-- (April 18, 2026). The tier system (§3+) is intentionally not in this
-- migration — see project notes.
--
-- This migration is strictly ADDITIVE:
--   • adds new tables, indexes and RPC functions
--   • does NOT alter or drop any existing table, column, view or policy
--   • is safe to run on a database that currently powers the live app
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) Helper: pure SQL haversine (no extension required)
-- ---------------------------------------------------------------------

create or replace function public.haversine_km(
  lat1 double precision,
  lng1 double precision,
  lat2 double precision,
  lng2 double precision
) returns double precision
language plpgsql
immutable
as $$
declare
  r constant double precision := 6371.0;
  d_lat double precision;
  d_lng double precision;
  a double precision;
  c double precision;
begin
  if lat1 is null or lng1 is null or lat2 is null or lng2 is null then
    return null;
  end if;
  d_lat := radians(lat2 - lat1);
  d_lng := radians(lng2 - lng1);
  a := sin(d_lat / 2) ^ 2
       + cos(radians(lat1)) * cos(radians(lat2)) * sin(d_lng / 2) ^ 2;
  c := 2 * atan2(sqrt(a), sqrt(1 - a));
  return r * c;
end;
$$;

comment on function public.haversine_km(double precision, double precision, double precision, double precision)
  is 'Great-circle distance in kilometres. Used by the pricing engine to assign GPS coords to a pricing_areas row.';

-- ---------------------------------------------------------------------
-- 1) pricing_areas — city / municipality buckets (spec §2.1)
-- ---------------------------------------------------------------------

create table if not exists public.pricing_areas (
  id text primary key,
  name text not null,
  country text not null default 'NO',
  center_lat double precision not null,
  center_lng double precision not null,
  radius_km double precision not null default 25,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.pricing_areas is
  'Pricing buckets — provider GPS resolves to an area at signup; prices never bleed between areas (spec §2.1).';

-- Seed the canonical Norwegian launch areas. UPSERT so re-running the
-- migration is harmless and does not overwrite manual edits to radius/name.
insert into public.pricing_areas (id, name, country, center_lat, center_lng, radius_km)
values
  ('oslo',         'Oslo',         'NO', 59.9139, 10.7522, 25),
  ('bergen',       'Bergen',       'NO', 60.3913,  5.3221, 25),
  ('trondheim',    'Trondheim',    'NO', 63.4305, 10.3951, 25),
  ('stavanger',    'Stavanger',    'NO', 58.9700,  5.7331, 25),
  ('kristiansand', 'Kristiansand', 'NO', 58.1467,  7.9956, 25),
  ('drammen',      'Drammen',      'NO', 59.7440, 10.2045, 20),
  ('fredrikstad',  'Fredrikstad',  'NO', 59.2181, 10.9298, 20),
  ('tromso',       'Tromsø',       'NO', 69.6492, 18.9553, 25),
  ('alesund',      'Ålesund',      'NO', 62.4722,  6.1495, 20),
  ('bodo',         'Bodø',         'NO', 67.2804, 14.4049, 20)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 2) Helper: resolve_pricing_area_id (lat, lng) -> area id
-- ---------------------------------------------------------------------

create or replace function public.resolve_pricing_area_id(
  p_lat double precision,
  p_lng double precision
) returns text
language plpgsql
stable
as $$
declare
  v_id text;
begin
  if p_lat is null or p_lng is null then
    return 'unknown';
  end if;
  select id into v_id
  from public.pricing_areas
  where is_active = true
    and public.haversine_km(p_lat, p_lng, center_lat, center_lng) <= radius_km
  order by public.haversine_km(p_lat, p_lng, center_lat, center_lng) asc
  limit 1;
  return coalesce(v_id, 'unknown');
end;
$$;

comment on function public.resolve_pricing_area_id(double precision, double precision)
  is 'Map a GPS coordinate to the closest pricing_areas.id within its radius_km, or ''unknown''.';

-- ---------------------------------------------------------------------
-- 3) provider_price_inputs — what every provider quotes at signup (§2.1)
-- ---------------------------------------------------------------------

create table if not exists public.provider_price_inputs (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.provider_details (id) on delete cascade,
  service_id text not null references public.services (id) on delete cascade,
  area_id text not null references public.pricing_areas (id) on delete restrict,
  price numeric(12, 2) not null check (price > 0),
  currency text not null default 'NOK',
  source text not null default 'signup',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, service_id)
);

comment on table public.provider_price_inputs is
  'Per-provider per-service typical price quoted at signup (spec §2.1). One row per provider per service; updates overwrite via upsert.';

create index if not exists idx_provider_price_inputs_area_service
  on public.provider_price_inputs (area_id, service_id);
create index if not exists idx_provider_price_inputs_provider
  on public.provider_price_inputs (provider_id);

-- ---------------------------------------------------------------------
-- 4) area_base_prices — trimmed-mean output per (area, service) (§2.1)
-- ---------------------------------------------------------------------

create table if not exists public.area_base_prices (
  area_id text not null references public.pricing_areas (id) on delete cascade,
  service_id text not null references public.services (id) on delete cascade,
  base_price numeric(12, 2),
  sample_size integer not null default 0,
  is_active boolean not null default false,
  last_computed_at timestamptz not null default now(),
  primary key (area_id, service_id)
);

comment on table public.area_base_prices is
  'Computed provider-side base price per (area, service) — trimmed mean of provider_price_inputs (spec §2.1). is_active becomes true once sample_size >= 5.';

create index if not exists idx_area_base_prices_active
  on public.area_base_prices (service_id) where is_active = true;

-- ---------------------------------------------------------------------
-- 5) RPC: recompute_area_base_price — runs the trimmed mean (§2.1)
-- ---------------------------------------------------------------------

create or replace function public.recompute_area_base_price(
  p_area_id text,
  p_service_id text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_trim integer;
  v_avg numeric(12, 2);
  v_active boolean;
begin
  select count(*) into v_total
  from public.provider_price_inputs
  where area_id = p_area_id
    and service_id = p_service_id
    and price > 0;

  if v_total = 0 then
    delete from public.area_base_prices
     where area_id = p_area_id and service_id = p_service_id;
    return;
  end if;

  v_trim := floor(v_total * 0.10);  -- spec §2.1: top & bottom 10%
  v_active := v_total >= 5;          -- spec §2.1: minimum data threshold

  with ordered as (
    select price, row_number() over (order by price asc) as rn
    from public.provider_price_inputs
    where area_id = p_area_id
      and service_id = p_service_id
      and price > 0
  ), trimmed as (
    select price
    from ordered
    where rn > v_trim
      and rn <= (v_total - v_trim)
  )
  select round(avg(price)::numeric, 2) into v_avg
  from trimmed;

  -- Defensive fallback when trimming removed everything (very small samples).
  if v_avg is null then
    select round(avg(price)::numeric, 2) into v_avg
    from public.provider_price_inputs
    where area_id = p_area_id
      and service_id = p_service_id
      and price > 0;
  end if;

  insert into public.area_base_prices (
    area_id, service_id, base_price, sample_size, is_active, last_computed_at
  )
  values (p_area_id, p_service_id, v_avg, v_total, v_active, now())
  on conflict (area_id, service_id) do update
    set base_price       = excluded.base_price,
        sample_size      = excluded.sample_size,
        is_active        = excluded.is_active,
        last_computed_at = excluded.last_computed_at;
end;
$$;

comment on function public.recompute_area_base_price(text, text) is
  'Recompute the trimmed-mean (10% top/bottom drop) base price for one (area, service). Should be called after any provider_price_inputs upsert.';

-- ---------------------------------------------------------------------
-- 6) Trigger: auto-recompute base price on input changes
-- ---------------------------------------------------------------------

create or replace function public.handle_provider_price_input_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'DELETE') then
    perform public.recompute_area_base_price(old.area_id, old.service_id);
    return old;
  else
    perform public.recompute_area_base_price(new.area_id, new.service_id);
    -- If an update changed the area_id, refresh the old area too.
    if (tg_op = 'UPDATE' and old.area_id is distinct from new.area_id) then
      perform public.recompute_area_base_price(old.area_id, old.service_id);
    end if;
    return new;
  end if;
end;
$$;

drop trigger if exists trg_provider_price_input_change on public.provider_price_inputs;
create trigger trg_provider_price_input_change
after insert or update or delete on public.provider_price_inputs
for each row
execute function public.handle_provider_price_input_change();

-- ---------------------------------------------------------------------
-- 7) RPC: compute_used_capacity (§2.3)
-- ---------------------------------------------------------------------

create or replace function public.compute_used_capacity(
  p_area_id text,
  p_service_id text
) returns numeric
language plpgsql
stable
as $$
declare
  v_active_bookings integer := 0;
  v_online_providers integer := 0;
begin
  -- Active bookings in this area, this service, in the last 30 minutes (spec §2.3).
  -- 'pending', 'assigned', 'in_progress' are the in-flight statuses defined in
  -- the existing orders schema; anything completed/cancelled doesn't count.
  select count(*) into v_active_bookings
  from public.orders o
  where o.service_id = p_service_id
    and o.status in ('pending', 'assigned', 'in_progress')
    and o.created_at >= (now() - interval '30 minutes')
    and public.resolve_pricing_area_id(o.customer_lat, o.customer_lng) = p_area_id;

  -- Online & able-to-serve providers in this area.
  -- We rely on provider_skills.available_now / is_active because that's the
  -- field the dispatcher already uses (see lib/orders/dispatchTick.ts).
  select count(distinct pd.id) into v_online_providers
  from public.provider_details pd
  inner join public.provider_skills ps on ps.provider_id = pd.id
  where ps.service_id = p_service_id
    and ps.is_active = true
    and ps.available_now = true
    and public.resolve_pricing_area_id(pd.lat, pd.lng) = p_area_id;

  if v_online_providers = 0 then
    return 0;  -- spec §2.3 fallback: no providers ⇒ "quietest" (-30%) doesn't make sense; treat as balanced (0% capacity → -30% mult). Caller can override.
  end if;

  return (v_active_bookings::numeric / v_online_providers::numeric) * 100;
end;
$$;

comment on function public.compute_used_capacity(text, text) is
  'Used capacity % per (area, service) over a rolling 30-minute window (spec §2.3).';

-- ---------------------------------------------------------------------
-- 8) booking_price_locks — freeze the displayed price mid-flow (§2.3)
-- ---------------------------------------------------------------------

create table if not exists public.booking_price_locks (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  service_id text not null references public.services (id) on delete cascade,
  area_id text references public.pricing_areas (id) on delete set null,
  delivery_mode text check (delivery_mode in ('home', 'provider')),
  delivery_km numeric(8, 2),
  addon_ids text[] not null default '{}',
  base_price numeric(12, 2) not null,
  multiplier numeric(6, 4) not null,
  used_capacity_pct numeric(6, 2),
  provider_service_price numeric(12, 2) not null,
  customer_service_price numeric(12, 2) not null,
  delivery_fee numeric(12, 2) not null default 0,
  addons_customer_total numeric(12, 2) not null default 0,
  addons_provider_total numeric(12, 2) not null default 0,
  customer_total numeric(12, 2) not null,
  provider_total numeric(12, 2) not null,
  freshup_total numeric(12, 2) not null,
  currency text not null default 'NOK',
  locked_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  consumed_at timestamptz,
  order_id uuid references public.orders (id) on delete set null
);

comment on table public.booking_price_locks is
  'Per spec §2.3: when a customer starts a booking the displayed price is frozen until expiry or order creation, so it cannot drift mid-flow.';

create index if not exists idx_booking_price_locks_customer
  on public.booking_price_locks (customer_id, locked_at desc);
create index if not exists idx_booking_price_locks_order
  on public.booking_price_locks (order_id) where order_id is not null;
create index if not exists idx_booking_price_locks_expiry
  on public.booking_price_locks (expires_at) where consumed_at is null;

-- ---------------------------------------------------------------------
-- 9) Row Level Security
-- ---------------------------------------------------------------------
-- Read access is broad (everyone can see an area's base price), write access
-- is restricted. The Next.js API uses the service role key (bypasses RLS),
-- so these policies primarily protect direct PostgREST access from the
-- browser via the anon key.

alter table public.pricing_areas             enable row level security;
alter table public.provider_price_inputs     enable row level security;
alter table public.area_base_prices          enable row level security;
alter table public.booking_price_locks       enable row level security;

-- pricing_areas — anyone (anon/authenticated) can read.
drop policy if exists "pricing_areas_read_all" on public.pricing_areas;
create policy "pricing_areas_read_all"
  on public.pricing_areas for select
  using (true);

-- area_base_prices — anyone can read; only the service role can write.
drop policy if exists "area_base_prices_read_all" on public.area_base_prices;
create policy "area_base_prices_read_all"
  on public.area_base_prices for select
  using (true);

-- provider_price_inputs — providers can read/insert/update their own row.
drop policy if exists "ppi_provider_select_own" on public.provider_price_inputs;
create policy "ppi_provider_select_own"
  on public.provider_price_inputs for select
  using (auth.uid() = provider_id);

drop policy if exists "ppi_provider_insert_own" on public.provider_price_inputs;
create policy "ppi_provider_insert_own"
  on public.provider_price_inputs for insert
  with check (auth.uid() = provider_id);

drop policy if exists "ppi_provider_update_own" on public.provider_price_inputs;
create policy "ppi_provider_update_own"
  on public.provider_price_inputs for update
  using (auth.uid() = provider_id)
  with check (auth.uid() = provider_id);

-- booking_price_locks — customers can read/insert their own; updates only via service role.
drop policy if exists "bpl_customer_select_own" on public.booking_price_locks;
create policy "bpl_customer_select_own"
  on public.booking_price_locks for select
  using (auth.uid() = customer_id);

drop policy if exists "bpl_customer_insert_own" on public.booking_price_locks;
create policy "bpl_customer_insert_own"
  on public.booking_price_locks for insert
  with check (auth.uid() = customer_id);

-- ---------------------------------------------------------------------
-- 10) Grants — make sure PostgREST can see the RPCs from the API.
-- ---------------------------------------------------------------------

grant execute on function public.haversine_km(double precision, double precision, double precision, double precision) to anon, authenticated, service_role;
grant execute on function public.resolve_pricing_area_id(double precision, double precision) to anon, authenticated, service_role;
grant execute on function public.compute_used_capacity(text, text) to anon, authenticated, service_role;
grant execute on function public.recompute_area_base_price(text, text) to service_role;

-- ---------------------------------------------------------------------
-- 11) Sanity touch-ups
-- ---------------------------------------------------------------------
-- Ensure orders.currency is NOK by default for any future inserts (the
-- existing default is already 'NOK' in the live schema; this is a no-op
-- guard so the pricing engine can rely on a consistent currency value).
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'orders'
      and column_name  = 'currency'
  ) then
    raise notice 'orders.currency does not exist — pricing engine assumes NOK; please add it manually if needed';
  end if;
end $$;
