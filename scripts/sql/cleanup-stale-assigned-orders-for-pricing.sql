-- One-off cleanup: assigned orders that inflate used_capacity when the RPC
-- lacks a 30-minute window. Run manually in Supabase SQL editor after review.
--
-- Symptom: low_fade shows ~16.67% (1/6) despite no recent bookings.
-- Cause: order stuck in `assigned` for days (e.g. 6f039ce9-e38e-4503-8e48-1bb2aea391a7).

-- 1) Preview candidates (assigned, never progressed, older than 30 minutes)
select
  o.id,
  o.service_id,
  o.status,
  o.created_at,
  o.customer_lat,
  o.customer_lng,
  public.resolve_pricing_area_id(o.customer_lat, o.customer_lng) as pricing_area_id
from public.orders o
where o.status = 'assigned'::public.order_status
  and o.created_at < (now() - interval '30 minutes')
order by o.created_at asc;

-- 2) Optional: cancel a specific known stale row (uncomment after confirming preview)
-- update public.orders
-- set
--   status = 'cancelled'::public.order_status,
--   cancelled_at = now(),
--   cancellation_reason = 'manual_stale_assigned_cleanup',
--   updated_at = now()
-- where id = '6f039ce9-e38e-4503-8e48-1bb2aea391a7'::uuid
--   and status = 'assigned'::public.order_status;

-- 3) Optional: bulk-cancel assigned orders older than 24h that never left assigned
-- (only use if your product flow never keeps a valid job in assigned that long)
-- update public.orders o
-- set
--   status = 'cancelled'::public.order_status,
--   cancelled_at = now(),
--   cancellation_reason = 'auto_stale_assigned_cleanup',
--   updated_at = now()
-- where o.status = 'assigned'::public.order_status
--   and o.created_at < (now() - interval '24 hours');
