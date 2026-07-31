-- profiles stored location twice (default_location_label/lat/lng and default_address/default_lat/default_lng).
-- Keep the canonical trio and drop the duplicate default_* columns.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision;

UPDATE public.profiles
SET
  default_location_label = COALESCE(
    NULLIF(trim(default_location_label), ''),
    NULLIF(trim(default_address), '')
  ),
  lat = COALESCE(lat, default_lat),
  lng = COALESCE(lng, default_lng)
WHERE default_lat IS NOT NULL
   OR default_lng IS NOT NULL
   OR default_address IS NOT NULL;

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS default_address,
  DROP COLUMN IF EXISTS default_lat,
  DROP COLUMN IF EXISTS default_lng;

COMMENT ON COLUMN public.profiles.default_location_label IS
  'Customer default delivery address label.';
COMMENT ON COLUMN public.profiles.lat IS
  'Customer default delivery latitude.';
COMMENT ON COLUMN public.profiles.lng IS
  'Customer default delivery longitude.';
