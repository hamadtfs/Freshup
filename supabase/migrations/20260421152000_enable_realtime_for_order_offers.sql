-- Enable Supabase Realtime for order_offers so providers receive offers instantly.
-- Without publication membership, the client will only see offers after refresh (initial fetch).

DO $$
BEGIN
  -- Add table to realtime publication if not already present.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'order_offers'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.order_offers;';
  END IF;
END $$;

