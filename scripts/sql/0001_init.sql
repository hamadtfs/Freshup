-- Schema for Fresh Up (on-demand haircuts)

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  role text check (role in ('customer','provider','admin')) not null default 'customer',
  name text,
  phone text,
  photo_url text
);

create table if not exists provider_profiles (
  provider_id uuid primary key references profiles(id) on delete cascade,
  salon_name text,
  home_service boolean default true,
  capacity int default 1,
  radius_km real default 5,
  lat double precision not null,
  lng double precision not null,
  is_online boolean default false,
  open_hours jsonb
);

create table if not exists styles (
  id text primary key,
  name text not null,
  description text,
  base_price_min int not null,
  base_price_max int not null,
  base_minutes int not null,
  demand text check (demand in ('low','medium','high')) default 'low',
  active boolean default true
);

create table if not exists provider_styles (
  provider_id uuid references profiles(id) on delete cascade,
  style_id text references styles(id) on delete cascade,
  minutes_override int,
  price_min int,
  price_max int,
  primary key (provider_id, style_id)
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references profiles(id) on delete set null,
  provider_id uuid references profiles(id) on delete set null,
  status text check (status in ('searching','assigned','enroute','in_service','completed','cancelled')) not null default 'searching',
  mode text check (mode in ('home','salon')) not null,
  style_id text references styles(id),
  addons jsonb,
  price_est numeric,
  price_final numeric,
  customer_lat double precision not null,
  customer_lng double precision not null,
  salon_lat double precision,
  salon_lng double precision,
  eta_minutes_est int,
  created_at timestamptz not null default now()
);

create table if not exists order_offers (
  order_id uuid references orders(id) on delete cascade,
  provider_id uuid references profiles(id) on delete cascade,
  status text check (status in ('pending','accepted','expired')) not null default 'pending',
  created_at timestamptz not null default now(),
  primary key (order_id, provider_id)
);

create table if not exists order_events (
  order_id uuid references orders(id) on delete cascade,
  type text not null,
  data jsonb,
  created_at timestamptz not null default now()
);

create table if not exists ratings (
  order_id uuid primary key references orders(id) on delete cascade,
  stars int check (stars between 1 and 5),
  comment text,
  style_fit_score int
);

create table if not exists payments (
  order_id uuid primary key references orders(id) on delete cascade,
  status text,
  amount int,
  provider_payout int,
  fee int
);

create table if not exists realtime_locations (
  provider_id uuid primary key references profiles(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  updated_at timestamptz not null default now()
);

-- RLS
alter table profiles enable row level security;
alter table provider_profiles enable row level security;
alter table provider_styles enable row level security;
alter table orders enable row level security;
alter table order_offers enable row level security;
alter table order_events enable row level security;
alter table ratings enable row level security;
alter table realtime_locations enable row level security;
alter table payments enable row level security;

-- Basic policies (adjust with auth integration):
-- Customers can see own orders
create policy "customer select own orders" on orders for select
  using (auth.uid() = customer_id);
create policy "customer insert orders" on orders for insert
  with check (auth.uid() = customer_id);
create policy "customer update own orders minimal" on orders for update
  using (auth.uid() = customer_id);

-- Providers can see orders assigned to them
create policy "provider select assigned orders" on orders for select
  using (auth.uid() = provider_id);
create policy "provider update assigned orders" on orders for update
  using (auth.uid() = provider_id);

-- Providers see their offers
create policy "provider select offers" on order_offers for select
  using (auth.uid() = provider_id);

-- Providers can update their location
create policy "provider upsert location" on realtime_locations for insert
  with check (auth.uid() = provider_id);
create policy "provider update location" on realtime_locations for update
  using (auth.uid() = provider_id);

-- Admin blanket (example; adjust: add admin check)
create policy "admin select all orders" on orders for select using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

-- Seed styles
insert into styles (id,name,description,base_price_min,base_price_max,base_minutes,demand,active) values
  ('mid-fade','Mid Fade','Ren overgang midt på hodet. Passer de fleste hårtyper.',350,450,35,'medium',true),
  ('high-fade','High Fade','Kortere i sidene, høyere overgang for skarp look.',380,500,40,'high',true),
  ('taper','Taper','Naturlig gradvis overgang. Diskret og stilrent.',320,420,30,'low',true),
  ('low-fade','Low Fade','Overgang lavt på sidene for myk profil.',340,440,35,'medium',true),
  ('skin-fade','Skin Fade','Helt ned til hud i sidene for maksimal kontrast.',420,560,45,'high',true)
on conflict (id) do nothing;

-- Seed demo providers (replace with real auth-managed IDs)
-- WARNING: In real deployments, provider ids come from Auth users; this is for local testing.
insert into profiles (id, role, name) values
  ('00000000-0000-0000-0000-000000000101','provider','Mina Barber'),
  ('00000000-0000-0000-0000-000000000102','provider','Stian Stylist')
on conflict (id) do nothing;

insert into provider_profiles (provider_id, salon_name, home_service, capacity, radius_km, lat, lng, is_online) values
  ('00000000-0000-0000-0000-000000000101','Fresh Up Sentrum', true, 2, 6, 59.9132, 10.7410, true),
  ('00000000-0000-0000-0000-000000000102','Fresh Up Frogner', true, 1, 5, 59.9290, 10.7080, true)
on conflict (provider_id) do nothing;

insert into provider_styles (provider_id, style_id) values
  ('00000000-0000-0000-0000-000000000101','mid-fade'),
  ('00000000-0000-0000-0000-000000000101','taper'),
  ('00000000-0000-0000-0000-000000000101','skin-fade'),
  ('00000000-0000-0000-0000-000000000102','low-fade'),
  ('00000000-0000-0000-0000-000000000102','high-fade')
on conflict do nothing;
