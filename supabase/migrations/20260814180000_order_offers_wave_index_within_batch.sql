-- order_offers.wave_index: one meaning for the whole table.
-- Spec: 1–3 within the batch (Gold / Silver / Bronze). batch_index is the batch.
-- Legacy rows stored the global 0–17 tick step in the same column.
-- Map: new_wave = (old_wave_index % 3) + 1
-- Apply manually — do not run from the agent.

-- ---------------------------------------------------------------------------
-- Backfill legacy global steps. Do not remap rows already on 1–3.
-- Ambiguous stored values 1, 2, 3: old step iff provider_tier still matches
-- the legacy (step % 3) slot. New writers store Gold on 1, which does not
-- match that slot, so they stay put.
-- ---------------------------------------------------------------------------
UPDATE public.order_offers
SET wave_index = (wave_index % 3) + 1
WHERE wave_index IS NOT NULL
  AND (
    wave_index < 1
    OR wave_index > 3
    OR (
      provider_tier IS NOT NULL
      AND batch_index IS NOT NULL
      AND wave_index = batch_index * 3 + (wave_index % 3)
      AND provider_tier = (ARRAY['gold'::text, 'silver'::text, 'bronze'::text])[(wave_index % 3) + 1]
    )
  );

COMMENT ON COLUMN public.order_offers.wave_index IS
  '1–3 within the batch (1=gold, 2=silver, 3=bronze). Not the global 0–17 tick step; that lives on orders.dispatch_wave_index. batch_index is the batch.';

-- ---------------------------------------------------------------------------
-- Insert fill: write 1–3, and normalize a legacy global step if the app
-- still sends 0–17 (all three columns set → previously skipped).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.order_offers_fill_dispatch_telemetry()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  prior integer;
  step integer;
  legacy_tier text;
BEGIN
  SELECT dispatch_wave_index INTO prior
  FROM public.orders
  WHERE id = NEW.order_id;

  IF prior IS NULL OR prior < 0 THEN
    step := 0;
  ELSE
    step := prior + 1;
  END IF;

  IF step > 17 THEN
    step := 17;
  END IF;

  IF NEW.batch_index IS NULL THEN
    NEW.batch_index := GREATEST(0, FLOOR(step::numeric / 3)::integer);
  END IF;

  IF NEW.wave_index IS NULL THEN
    NEW.wave_index := (step % 3) + 1;
  ELSIF NEW.wave_index < 1 OR NEW.wave_index > 3 THEN
    NEW.wave_index := (NEW.wave_index % 3) + 1;
  ELSIF NEW.batch_index IS NOT NULL AND NEW.provider_tier IS NOT NULL THEN
    legacy_tier := (ARRAY['gold'::text, 'silver'::text, 'bronze'::text])[(NEW.wave_index % 3) + 1];
    IF NEW.provider_tier = legacy_tier
       AND NEW.wave_index = NEW.batch_index * 3 + (NEW.wave_index % 3) THEN
      NEW.wave_index := (NEW.wave_index % 3) + 1;
    END IF;
  END IF;

  IF NEW.provider_tier IS NULL THEN
    NEW.provider_tier := (ARRAY['gold'::text, 'silver'::text, 'bronze'::text])[(step % 3) + 1];
  END IF;

  RETURN NEW;
END;
$$;

ALTER TABLE public.order_offers
  DROP CONSTRAINT IF EXISTS order_offers_wave_index_check;

ALTER TABLE public.order_offers
  ADD CONSTRAINT order_offers_wave_index_check
  CHECK (wave_index IS NULL OR wave_index BETWEEN 1 AND 3);
