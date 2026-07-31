-- FreshUp local seed for Point #1 foundation
-- Safe to run multiple times (upserts / conflict guards).

-- Modes
INSERT INTO public.modes (id, label, icon, sort_order)
VALUES
  ('beauty', 'Beauty', 'scissors', 10),
  ('health', 'Health', 'heart', 20),
  ('pet', 'Pet', 'paw-print', 30),
  ('delivery', 'Delivery', 'truck', 40)
ON CONFLICT (id) DO UPDATE
SET
  label = EXCLUDED.label,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order;

-- Targets
INSERT INTO public.targets (id, mode_id, label, icon, sort_order)
VALUES
  ('women', 'beauty', 'Women', 'user-round', 10),
  ('men', 'beauty', 'Men', 'user-round', 20),
  ('kids', 'beauty', 'Kids', 'baby', 30),
  ('dog', 'pet', 'Dog', 'dog', 10),
  ('cat', 'pet', 'Cat', 'cat', 20),
  ('home', 'health', 'Home Visit', 'house', 10)
ON CONFLICT (id) DO UPDATE
SET
  mode_id = EXCLUDED.mode_id,
  label = EXCLUDED.label,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order;

-- Categories
INSERT INTO public.categories (id, mode_id, target_id, label, icon, sort_order)
VALUES
  ('haircut_women', 'beauty', 'women', 'Haircut', 'scissors', 10),
  ('nails_women', 'beauty', 'women', 'Nails', 'sparkles', 20),
  ('haircut_men', 'beauty', 'men', 'Haircut', 'scissors', 10),
  ('pet_grooming_dog', 'pet', 'dog', 'Grooming', 'sparkles', 10),
  ('pet_health_cat', 'pet', 'cat', 'Health Check', 'stethoscope', 10),
  ('nursing_home', 'health', 'home', 'Nursing', 'heart-pulse', 10)
ON CONFLICT (id) DO UPDATE
SET
  mode_id = EXCLUDED.mode_id,
  target_id = EXCLUDED.target_id,
  label = EXCLUDED.label,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order;

-- Services
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
  ('fade_cut', 'beauty', 'men', 'haircut_men', 'Fade Cut', 'Classic fade cut', 45, 250, 450, 10, true),
  ('taper_cut', 'beauty', 'men', 'haircut_men', 'Taper Cut', 'Taper style haircut', 40, 220, 420, 20, true),
  ('buzz_cut', 'beauty', 'men', 'haircut_men', 'Buzz Cut', 'Short buzz style', 20, 120, 220, 30, true),
  ('layer_cut', 'beauty', 'women', 'haircut_women', 'Layer Cut', 'Women layer haircut', 60, 350, 650, 10, true),
  ('manicure_basic', 'beauty', 'women', 'nails_women', 'Basic Manicure', 'Nail cleaning and polish', 45, 200, 350, 20, true),
  ('dog_groom_basic', 'pet', 'dog', 'pet_grooming_dog', 'Dog Grooming Basic', 'Bath and trim', 60, 300, 550, 10, true),
  ('cat_health_check', 'pet', 'cat', 'pet_health_cat', 'Cat Health Check', 'General health screening', 30, 250, 400, 10, true),
  ('home_nursing_visit', 'health', 'home', 'nursing_home', 'Home Nursing Visit', 'Basic home nursing support', 60, 500, 900, 10, true)
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
