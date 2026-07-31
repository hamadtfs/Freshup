-- Optional: persist final price on orders when completing.
-- The app can function without this column; completion now updates status/completed_at only.

ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS price_final numeric;

