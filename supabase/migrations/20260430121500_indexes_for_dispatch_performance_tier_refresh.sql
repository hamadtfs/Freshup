-- Speed up refresh_dispatch_performance_tiers() and dispatch-related time-range scans.
-- Helps avoid statement timeouts when order_offers / orders grow.
-- Runs before 20260430123000_refresh_dispatch_performance_tiers.sql

CREATE INDEX IF NOT EXISTS idx_order_offers_created_at
  ON public.order_offers (created_at);

CREATE INDEX IF NOT EXISTS idx_order_offers_provider_created_at
  ON public.order_offers (provider_id, created_at);

CREATE INDEX IF NOT EXISTS idx_orders_provider_accepted_at
  ON public.orders (provider_id, accepted_at)
  WHERE provider_id IS NOT NULL AND accepted_at IS NOT NULL;
