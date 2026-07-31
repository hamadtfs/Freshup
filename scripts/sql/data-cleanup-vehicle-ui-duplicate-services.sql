-- Remove legacy short vehicle UI service ids that duplicate canonical car_* rows.
--
-- Duplicates (short → keep):
--   battery        → car_battery
--   brake-check    → car_brake_check
--   oil-change-car → car_oil_change
--   air_filter     → car_air_filter
--   air-filter     → car_air_filter (if present)
--
-- ⚠️  Remap FKs first — services FKs are ON DELETE CASCADE (would wipe orders).
-- Run manually / review before apply.

begin;

create temporary table _svc_remap (
  old_id text primary key,
  new_id text not null
) on commit drop;

insert into _svc_remap (old_id, new_id) values
  ('battery', 'car_battery'),
  ('brake-check', 'car_brake_check'),
  ('oil-change-car', 'car_oil_change'),
  ('air_filter', 'car_air_filter'),
  ('air-filter', 'car_air_filter');

-- demand_zones PK (grid_id, service_id): drop short rows that would collide
delete from public.demand_zones d
using _svc_remap m
where d.service_id = m.old_id
  and exists (
    select 1
    from public.demand_zones c
    where c.grid_id = d.grid_id
      and c.service_id = m.new_id
  );

update public.demand_zones d
set service_id = m.new_id
from _svc_remap m
where d.service_id = m.old_id;

-- area_base_prices PK (area_id, service_id)
delete from public.area_base_prices a
using _svc_remap m
where a.service_id = m.old_id
  and exists (
    select 1
    from public.area_base_prices c
    where c.area_id = a.area_id
      and c.service_id = m.new_id
  );

update public.area_base_prices a
set service_id = m.new_id
from _svc_remap m
where a.service_id = m.old_id;

-- provider_price_inputs unique (provider_id, service_id)
delete from public.provider_price_inputs p
using _svc_remap m
where p.service_id = m.old_id
  and exists (
    select 1
    from public.provider_price_inputs c
    where c.provider_id = p.provider_id
      and c.service_id = m.new_id
  );

update public.provider_price_inputs p
set service_id = m.new_id
from _svc_remap m
where p.service_id = m.old_id;

-- provider_skills unique likely (provider_id, service_id)
delete from public.provider_skills p
using _svc_remap m
where p.service_id = m.old_id
  and exists (
    select 1
    from public.provider_skills c
    where c.provider_id = p.provider_id
      and c.service_id = m.new_id
  );

update public.provider_skills p
set service_id = m.new_id
from _svc_remap m
where p.service_id = m.old_id;

-- provider_services
delete from public.provider_services p
using _svc_remap m
where p.service_id = m.old_id
  and exists (
    select 1
    from public.provider_services c
    where c.provider_id = p.provider_id
      and c.service_id = m.new_id
  );

update public.provider_services p
set service_id = m.new_id
from _svc_remap m
where p.service_id = m.old_id;

update public.booking_price_locks b
set service_id = m.new_id
from _svc_remap m
where b.service_id = m.old_id;

update public.orders o
set service_id = m.new_id
from _svc_remap m
where o.service_id = m.old_id;

update public.area_capacity_snapshots a
set service_id = m.new_id
from _svc_remap m
where a.service_id = m.old_id;

update public.service_addons a
set service_id = m.new_id
from _svc_remap m
where a.service_id = m.old_id;

-- jobs has service_id but may not FK to services
update public.jobs j
set service_id = m.new_id
from _svc_remap m
where j.service_id = m.old_id;

delete from public.services s
using _svc_remap m
where s.id = m.old_id;

commit;

-- verify
select id, name, target_id, category_id
from public.services
where id in (
  'battery', 'brake-check', 'oil-change-car', 'air_filter', 'air-filter',
  'car_battery', 'car_brake_check', 'car_oil_change', 'car_air_filter'
)
order by id;
