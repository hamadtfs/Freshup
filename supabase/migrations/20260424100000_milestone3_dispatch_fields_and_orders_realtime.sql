-- Milestone 3: dispatch state fields + soft lock + enable Realtime on orders.
-- Note: do NOT apply automatically; run migrations manually.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS dispatch_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatch_deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatch_wave_index integer,
  ADD COLUMN IF NOT EXISTS dispatch_wave_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatch_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatch_lock_token uuid;

-- Speed up tick worker scans for active hunts.
CREATE INDEX IF NOT EXISTS idx_orders_dispatch_tick
  ON public.orders (status, dispatch_deadline_at)
  WHERE status IN ('pending', 'offered') AND provider_id IS NULL;

-- Enable Supabase Realtime for orders so customers can subscribe to status changes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'orders'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;';
  END IF;
END $$;

