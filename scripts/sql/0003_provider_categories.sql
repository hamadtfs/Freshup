-- Optional: provider categories for map filtering
create table if not exists provider_categories (
  provider_id uuid references profiles(id) on delete cascade,
  category text not null,
  primary key (provider_id, category)
);

-- Example seed: map existing demo providers to a few categories
insert into provider_categories (provider_id, category) values
  ('00000000-0000-0000-0000-000000000101','haircut'),
  ('00000000-0000-0000-0000-000000000101','braids'),
  ('00000000-0000-0000-0000-000000000102','haircut'),
  ('00000000-0000-0000-0000-000000000102','nails'),
  ('00000000-0000-0000-0000-000000000102','brows')
on conflict do nothing;
