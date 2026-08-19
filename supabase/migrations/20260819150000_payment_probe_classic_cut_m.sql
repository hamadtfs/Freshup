-- Payment probe: exercise real Stripe live payment path with a non-zero
-- low amount (~15 NOK) without needing to backfill provider_skills for a
-- brand-new service id.
--
-- We repurpose an existing service id that already has provider skills:
--   classic_cut_m
--
-- Note: this migration ONLY changes the service pricing metadata.
-- Hiding/exposing for Munib is done in app code (services-list filtering).

update public.services
set
  name = 'Payment probe (15 kr)',
  description = 'Internal live payment test (hidden from normal catalog).',
  base_price_min = 15,
  base_price_max = 15,
  sort_order = 9999,
  is_active = true
where id = 'classic_cut_m';

