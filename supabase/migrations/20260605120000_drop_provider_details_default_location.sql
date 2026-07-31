-- provider_details.lat/lng/address are the single source of truth for dispatch and profile.
-- Copy any legacy default-location pin into operational columns, then drop duplicates.

UPDATE public.provider_details
SET
  lat = COALESCE(lat, default_lat),
  lng = COALESCE(lng, default_lng),
  address = COALESCE(
    NULLIF(trim(address), ''),
    NULLIF(trim(default_address), '')
  )
WHERE default_lat IS NOT NULL
   OR default_lng IS NOT NULL
   OR default_address IS NOT NULL;

ALTER TABLE public.provider_details
  DROP COLUMN IF EXISTS default_address,
  DROP COLUMN IF EXISTS default_lat,
  DROP COLUMN IF EXISTS default_lng;
