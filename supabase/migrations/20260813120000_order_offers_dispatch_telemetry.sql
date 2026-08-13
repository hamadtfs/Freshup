-- Per-offer dispatch telemetry for admin (Munib 11–13 Aug).
-- Written at offer send time. Does not populate dispatch_batches / dispatch_attempts.
-- Apply manually — do not run from the agent.

ALTER TABLE public.order_offers
  ADD COLUMN IF NOT EXISTS batch_index integer,
  ADD COLUMN IF NOT EXISTS wave_index integer,
  ADD COLUMN IF NOT EXISTS provider_tier text;

ALTER TABLE public.order_offers
  DROP CONSTRAINT IF EXISTS order_offers_provider_tier_check;

ALTER TABLE public.order_offers
  ADD CONSTRAINT order_offers_provider_tier_check
  CHECK (
    provider_tier IS NULL
    OR provider_tier = ANY (ARRAY['gold'::text, 'silver'::text, 'bronze'::text])
  );

COMMENT ON COLUMN public.order_offers.batch_index IS
  '0-based distance/rating batch (0 = Batch 1). Same meaning as orders.current_batch_index.';
COMMENT ON COLUMN public.order_offers.wave_index IS
  '0-based dispatch step (batch × 3 + tier slot). Same meaning as orders.dispatch_wave_index.';
COMMENT ON COLUMN public.order_offers.provider_tier IS
  'Performance tier at send time: gold | silver | bronze.';

CREATE INDEX IF NOT EXISTS idx_order_offers_order_wave
  ON public.order_offers (order_id, wave_index);
