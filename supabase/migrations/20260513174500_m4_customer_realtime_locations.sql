-- M4 map integration: order-scoped customer live location.
-- Complements provider_realtime_locations so provider and customer can track
-- each other during home and at-provider jobs.

create table if not exists public.customer_realtime_locations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy_m double precision,
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, order_id)
);

create index if not exists idx_customer_realtime_locations_order_recorded
  on public.customer_realtime_locations (order_id, recorded_at desc);

create index if not exists idx_customer_realtime_locations_customer_order
  on public.customer_realtime_locations (customer_id, order_id);

alter table public.customer_realtime_locations enable row level security;

drop policy if exists "customer_location_read_order_participants" on public.customer_realtime_locations;
create policy "customer_location_read_order_participants"
  on public.customer_realtime_locations
  for select
  using (
    exists (
      select 1
      from public.orders o
      where o.id = customer_realtime_locations.order_id
        and (
          o.customer_id = auth.uid()
          or o.provider_id = auth.uid()
        )
    )
  );

drop policy if exists "customer_location_insert_own_active_order" on public.customer_realtime_locations;
create policy "customer_location_insert_own_active_order"
  on public.customer_realtime_locations
  for insert
  with check (
    customer_id = auth.uid()
    and exists (
      select 1
      from public.orders o
      where o.id = customer_realtime_locations.order_id
        and o.customer_id = auth.uid()
        and o.status in ('assigned', 'en_route', 'arrived', 'in_progress')
    )
  );

drop policy if exists "customer_location_update_own_active_order" on public.customer_realtime_locations;
create policy "customer_location_update_own_active_order"
  on public.customer_realtime_locations
  for update
  using (
    customer_id = auth.uid()
    and exists (
      select 1
      from public.orders o
      where o.id = customer_realtime_locations.order_id
        and o.customer_id = auth.uid()
        and o.status in ('assigned', 'en_route', 'arrived', 'in_progress')
    )
  )
  with check (
    customer_id = auth.uid()
    and exists (
      select 1
      from public.orders o
      where o.id = customer_realtime_locations.order_id
        and o.customer_id = auth.uid()
        and o.status in ('assigned', 'en_route', 'arrived', 'in_progress')
    )
  );

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.customer_realtime_locations;
    exception
      when duplicate_object then null;
    end;
  end if;
end $$;

comment on table public.customer_realtime_locations is
  'Order-scoped customer GPS points for M4 bidirectional live job tracking.';
