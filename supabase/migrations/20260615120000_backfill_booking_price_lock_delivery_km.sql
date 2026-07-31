-- Backfill booking_price_locks.delivery_km for home orders accepted before
-- accept/route.ts started persisting provider distance on the lock row.
--
-- Symptom: delivery_fee and customer_total were updated at accept time, but
-- delivery_km stayed at the 1 km booking placeholder (DEFAULT_SEARCH_DELIVERY_KM).

-- 1) Preferred source: accepted offer distance (same value accept/route.ts uses).
update public.booking_price_locks bpl
set delivery_km = src.provider_distance_km
from (
  select distinct on (bpl2.id)
    bpl2.id as lock_id,
    round(oo.provider_distance_km::numeric, 2) as provider_distance_km
  from public.booking_price_locks bpl2
  join public.orders o on o.id = bpl2.order_id
  join public.order_offers oo
    on oo.order_id = o.id
    and oo.status = 'accepted'
  where bpl2.order_id is not null
    and bpl2.delivery_mode = 'home'
    and o.delivery_mode = 'home'
    and oo.provider_distance_km is not null
    and oo.provider_distance_km > 0
    and bpl2.delivery_km is distinct from round(oo.provider_distance_km::numeric, 2)
  order by bpl2.id, oo.responded_at desc nulls last
) src
where bpl.id = src.lock_id;

-- 2) Fallback: infer km from delivery_fee when no accepted-offer distance exists.
--    Inverse of spec §2.4: fee = max(160, 150 + 10 * km).
update public.booking_price_locks bpl
set delivery_km = round(
  case
    when bpl.delivery_fee > 160 then (bpl.delivery_fee - 150) / 10.0
    else 1.0
  end,
  2
)
where bpl.order_id is not null
  and bpl.delivery_mode = 'home'
  and bpl.delivery_fee is not null
  and bpl.delivery_km is not null
  and bpl.delivery_km <= 1
  and bpl.delivery_fee > 160
  and bpl.delivery_km is distinct from round((bpl.delivery_fee - 150) / 10.0, 2)
  and not exists (
    select 1
    from public.order_offers oo
    where oo.order_id = bpl.order_id
      and oo.status = 'accepted'
      and oo.provider_distance_km is not null
      and oo.provider_distance_km > 0
  );
