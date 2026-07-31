-- M2 performance tier for Architecture §4.3 (Gold / Silver / Bronze).
-- Independent from per-service competence_rating (skill stars).
-- Populated by your M2 metrics job; default allows dispatch to run before that exists.

ALTER TABLE public.provider_details
ADD COLUMN IF NOT EXISTS dispatch_performance_tier text
  NOT NULL
  DEFAULT 'gold';

ALTER TABLE public.provider_details
DROP CONSTRAINT IF EXISTS provider_details_dispatch_performance_tier_check;

ALTER TABLE public.provider_details
ADD CONSTRAINT provider_details_dispatch_performance_tier_check
CHECK (dispatch_performance_tier IN ('gold', 'silver', 'bronze'));

COMMENT ON COLUMN public.provider_details.dispatch_performance_tier IS
  'M2 30-day performance tier (gold|silver|bronze). Used for §4.3 notification order within a batch. Defaults to gold until metrics backfill.';

CREATE INDEX IF NOT EXISTS idx_provider_details_dispatch_performance_tier
  ON public.provider_details (dispatch_performance_tier);
