-- Remove mis-seeded `bob` under female/nails (canonical is bob_f in haircut).
-- Remap FKs first — services FKs are ON DELETE CASCADE.

begin;

delete from public.demand_zones d
where d.service_id = 'bob'
  and exists (
    select 1 from public.demand_zones c
    where c.grid_id = d.grid_id and c.service_id = 'bob_f'
  );
update public.demand_zones set service_id = 'bob_f' where service_id = 'bob';

delete from public.provider_skills p
where p.service_id = 'bob'
  and exists (
    select 1 from public.provider_skills c
    where c.provider_id = p.provider_id and c.service_id = 'bob_f'
  );
update public.provider_skills set service_id = 'bob_f' where service_id = 'bob';

delete from public.provider_price_inputs p
where p.service_id = 'bob'
  and exists (
    select 1 from public.provider_price_inputs c
    where c.provider_id = p.provider_id and c.service_id = 'bob_f'
  );
update public.provider_price_inputs set service_id = 'bob_f' where service_id = 'bob';

delete from public.area_base_prices a
where a.service_id = 'bob'
  and exists (
    select 1 from public.area_base_prices c
    where c.area_id = a.area_id and c.service_id = 'bob_f'
  );
update public.area_base_prices set service_id = 'bob_f' where service_id = 'bob';

update public.booking_price_locks set service_id = 'bob_f' where service_id = 'bob';
update public.orders set service_id = 'bob_f' where service_id = 'bob';
update public.jobs set service_id = 'bob_f' where service_id = 'bob';
update public.provider_services set service_id = 'bob_f' where service_id = 'bob';
update public.service_addons set service_id = 'bob_f' where service_id = 'bob';
update public.area_capacity_snapshots set service_id = 'bob_f' where service_id = 'bob';

delete from public.services where id = 'bob';

commit;
