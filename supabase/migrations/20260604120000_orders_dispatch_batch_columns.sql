-- Keep orders.current_batch_* in sync with dispatch_wave_index (set by dispatchTick).
-- Safe on environments that already added these columns manually.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS current_batch_index integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_batch_iteration integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_batch_sent_at timestamptz;

COMMENT ON COLUMN public.orders.current_batch_index IS
  '0-based distance/rating batch (0 = Batch 1). Updated with dispatch_wave_index in dispatchTick.';
COMMENT ON COLUMN public.orders.current_batch_iteration IS
  '1-based tier slot within batch: 1=gold, 2=silver, 3=bronze. Updated with dispatch_wave_index.';
COMMENT ON COLUMN public.orders.last_batch_sent_at IS
  'When the last dispatch wave inserted at least one order_offer.';

-- Backfill historical hunts (run once after deploy).
UPDATE public.orders
SET
  current_batch_index = GREATEST(0, FLOOR(dispatch_wave_index::numeric / 3)::integer),
  current_batch_iteration = (dispatch_wave_index % 3) + 1
WHERE dispatch_wave_index IS NOT NULL
  AND dispatch_wave_index >= 0;
