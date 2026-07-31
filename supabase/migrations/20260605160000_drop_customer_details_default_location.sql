-- customer_details.default_* were never used by the app; location lives on profiles.
-- Copy any legacy values into profiles, then drop the unused columns.

UPDATE public.profiles p
SET
  default_location_label = COALESCE(
    NULLIF(trim(p.default_location_label), ''),
    NULLIF(trim(cd.default_address), '')
  ),
  lat = COALESCE(p.lat, cd.default_lat::double precision),
  lng = COALESCE(p.lng, cd.default_lng::double precision),
  updated_at = now()
FROM public.customer_details cd
WHERE cd.id = p.id
  AND (
    cd.default_lat IS NOT NULL
    OR cd.default_lng IS NOT NULL
    OR NULLIF(trim(cd.default_address), '') IS NOT NULL
  )
  AND (
    p.lat IS NULL
    OR p.lng IS NULL
    OR NULLIF(trim(p.default_location_label), '') IS NULL
  );

ALTER TABLE public.customer_details
  DROP COLUMN IF EXISTS default_address,
  DROP COLUMN IF EXISTS default_lat,
  DROP COLUMN IF EXISTS default_lng;
