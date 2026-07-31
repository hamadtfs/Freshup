-- Unused provider_details denormalized rating counters and per-provider radius.
-- Dispatch uses wave distance params; ratings live in public.ratings; avg_rating is kept.

ALTER TABLE public.provider_details
  DROP COLUMN IF EXISTS rating_count,
  DROP COLUMN IF EXISTS total_rating_sum,
  DROP COLUMN IF EXISTS total_ratings,
  DROP COLUMN IF EXISTS radius_km;
