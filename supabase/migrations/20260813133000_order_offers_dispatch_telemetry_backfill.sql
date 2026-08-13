-- Backfill existing NULL telemetry and fill future inserts if the app omits columns.
-- Apply manually — do not run from the agent.

CREATE OR REPLACE FUNCTION public.order_offers_fill_dispatch_telemetry()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  prior integer;
  step integer;
BEGIN
  IF NEW.wave_index IS NOT NULL
     AND NEW.batch_index IS NOT NULL
     AND NEW.provider_tier IS NOT NULL THEN
    RETURN NEW;
  END IF;

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

  IF NEW.wave_index IS NULL THEN
    NEW.wave_index := step;
  END IF;
  IF NEW.batch_index IS NULL THEN
    NEW.batch_index := GREATEST(0, FLOOR(NEW.wave_index::numeric / 3)::integer);
  END IF;
  IF NEW.provider_tier IS NULL THEN
    NEW.provider_tier := (ARRAY['gold'::text, 'silver'::text, 'bronze'::text])[(NEW.wave_index % 3) + 1];
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_offers_fill_dispatch_telemetry ON public.order_offers;
CREATE TRIGGER order_offers_fill_dispatch_telemetry
  BEFORE INSERT ON public.order_offers
  FOR EACH ROW
  EXECUTE FUNCTION public.order_offers_fill_dispatch_telemetry();

-- Historical rows: infer wave from offer age vs dispatch_started_at (0/3/6s then +10s batches).
WITH inferred AS (
  SELECT
    oo.id,
    LEAST(17, GREATEST(0,
      COALESCE(
        (
          SELECT s::integer
          FROM generate_series(0, 17) AS s
          WHERE o.dispatch_started_at IS NOT NULL
            AND EXTRACT(EPOCH FROM (oo.created_at - o.dispatch_started_at))
              >= ((s / 3) * 10 + (s % 3) * 3)::numeric - 1.5
          ORDER BY s DESC
          LIMIT 1
        ),
        GREATEST(0, COALESCE(o.dispatch_wave_index, 0))
      )
    )) AS wave
  FROM public.order_offers oo
  JOIN public.orders o ON o.id = oo.order_id
  WHERE oo.wave_index IS NULL
     OR oo.batch_index IS NULL
     OR oo.provider_tier IS NULL
)
UPDATE public.order_offers oo
SET
  wave_index = i.wave,
  batch_index = (i.wave / 3),
  provider_tier = (ARRAY['gold'::text, 'silver'::text, 'bronze'::text])[(i.wave % 3) + 1]
FROM inferred i
WHERE oo.id = i.id;
