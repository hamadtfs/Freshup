-- M4 job lifecycle: order-scoped provider live location with Realtime/RLS.
-- Apply after 20260513162000_m4_job_lifecycle_location.sql so the `arrived`
-- enum value is committed before policies reference it.

create table if not exists public.provider_realtime_locations (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.provider_details (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy_m double precision,
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, order_id)
);

create index if not exists idx_provider_realtime_locations_order_recorded
  on public.provider_realtime_locations (order_id, recorded_at desc);

create index if not exists idx_provider_realtime_locations_provider_order
  on public.provider_realtime_locations (provider_id, order_id);

alter table public.provider_realtime_locations enable row level security;

drop policy if exists "provider_location_read_order_participants" on public.provider_realtime_locations;
create policy "provider_location_read_order_participants"
  on public.provider_realtime_locations
  for select
  using (
    exists (
      select 1
      from public.orders o
      where o.id = provider_realtime_locations.order_id
        and (
          o.customer_id = auth.uid()
          or o.provider_id = auth.uid()
        )
    )
  );

drop policy if exists "provider_location_insert_own_active_order" on public.provider_realtime_locations;
create policy "provider_location_insert_own_active_order"
  on public.provider_realtime_locations
  for insert
  with check (
    provider_id = auth.uid()
    and exists (
      select 1
      from public.orders o
      where o.id = provider_realtime_locations.order_id
        and o.provider_id = auth.uid()
        and o.status in ('en_route', 'arrived', 'in_progress')
    )
  );

drop policy if exists "provider_location_update_own_active_order" on public.provider_realtime_locations;
create policy "provider_location_update_own_active_order"
  on public.provider_realtime_locations
  for update
  using (
    provider_id = auth.uid()
    and exists (
      select 1
      from public.orders o
      where o.id = provider_realtime_locations.order_id
        and o.provider_id = auth.uid()
        and o.status in ('en_route', 'arrived', 'in_progress')
    )
  )
  with check (
    provider_id = auth.uid()
    and exists (
      select 1
      from public.orders o
      where o.id = provider_realtime_locations.order_id
        and o.provider_id = auth.uid()
        and o.status in ('en_route', 'arrived', 'in_progress')
    )
  );

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.provider_realtime_locations;
    exception
      when duplicate_object then null;
    end;
  end if;
end $$;

comment on table public.provider_realtime_locations is
  'Order-scoped provider GPS points for M4 live job tracking.';
