-- M4 demand zones: 1 km grid capacity data (map overlay in M5).

create table if not exists public.demand_zones (
  grid_id text not null,
  service_id text not null references public.services (id) on delete cascade,
  center_lat double precision not null,
  center_lng double precision not null,
  used_capacity_pct numeric(6, 2) not null default 0,
  active_bookings integer not null default 0,
  online_providers integer not null default 0,
  computed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (grid_id, service_id)
);

create index if not exists idx_demand_zones_service_computed
  on public.demand_zones (service_id, computed_at desc);

alter table public.demand_zones enable row level security;

drop policy if exists "demand_zones_read_authenticated" on public.demand_zones;
create policy "demand_zones_read_authenticated"
  on public.demand_zones
  for select
  to authenticated
  using (true);

comment on table public.demand_zones is
  'M4: per 1km grid used_capacity for demand heatmap (overlay rendering in M5).';

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.demand_zones;
    exception
      when duplicate_object then null;
    end;
  end if;
end $$;
