-- Provider home / default location used by profile settings and pricing area resolution.
ALTER TABLE public.provider_details
  ADD COLUMN IF NOT EXISTS default_address text,
  ADD COLUMN IF NOT EXISTS default_lat double precision,
  ADD COLUMN IF NOT EXISTS default_lng double precision;

COMMENT ON COLUMN public.provider_details.default_address IS
  'Provider home address label from profile default-location picker.';
COMMENT ON COLUMN public.provider_details.default_lat IS
  'Provider home latitude from profile default-location picker.';
COMMENT ON COLUMN public.provider_details.default_lng IS
  'Provider home longitude from profile default-location picker.';
