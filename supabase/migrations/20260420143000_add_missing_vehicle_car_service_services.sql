-- Ensure vehicle/car/service has the expected core services in DB
-- so dashboard and skills-page stay aligned after API hydration.
INSERT INTO public.services (
  id,
  mode_id,
  target_id,
  category_id,
  name,
  description,
  duration_minutes,
  base_price_min,
  base_price_max,
  sort_order,
  is_active
)
VALUES
  (
    'oil-change-car',
    'vehicle',
    'car',
    'service',
    'Oil Change',
    'Engine oil and filter replacement',
    45,
    699,
    799,
    10,
    true
  ),
  (
    'brake-check',
    'vehicle',
    'car',
    'service',
    'Brake Check',
    'Inspection of pads, discs, and brake fluid',
    30,
    399,
    499,
    20,
    true
  ),
  (
    'battery',
    'vehicle',
    'car',
    'service',
    'Battery',
    'Battery health test and replacement support',
    20,
    299,
    399,
    30,
    true
  )
ON CONFLICT (id) DO UPDATE
SET
  mode_id = EXCLUDED.mode_id,
  target_id = EXCLUDED.target_id,
  category_id = EXCLUDED.category_id,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  duration_minutes = EXCLUDED.duration_minutes,
  base_price_min = EXCLUDED.base_price_min,
  base_price_max = EXCLUDED.base_price_max,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active;
