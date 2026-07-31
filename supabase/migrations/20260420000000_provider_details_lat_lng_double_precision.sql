-- Change provider_details coordinates from NUMERIC to DOUBLE PRECISION.
-- provider_profiles depends on these columns, so we recreate that view around the type change.

DROP VIEW IF EXISTS public.provider_profiles;

ALTER TABLE public.provider_details
  ALTER COLUMN lat TYPE double precision USING lat::double precision,
  ALTER COLUMN lng TYPE double precision USING lng::double precision;

CREATE VIEW public.provider_profiles AS
SELECT
  pd.id AS provider_id,
  pd.lat,
  pd.lng,
  pd.is_online,
  COALESCE('home' = ANY(pd.delivery_modes), false) AS home_service
FROM public.provider_details pd;

GRANT SELECT ON public.provider_profiles TO anon, authenticated, service_role;
