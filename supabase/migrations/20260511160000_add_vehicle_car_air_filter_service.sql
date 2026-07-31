-- Vehicle / car / workshop: add air filter service (UI id air-filter via alias).
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
    'car_air_filter',
    'vehicle',
    'vehicle_car',
    'vehicle_car_service',
    'Air filter',
    'Engine intake air filter replacement',
    20,
    200,
    400,
    5,
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
