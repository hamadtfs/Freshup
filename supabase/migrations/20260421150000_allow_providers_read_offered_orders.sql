-- Allow providers to read orders that they have been offered.
-- Without this, providers can see rows in order_offers but cannot load the linked
-- orders row until it becomes assigned, causing the offer UI to not render.

DO $$
BEGIN
  -- Orders RLS is enabled in schema; add a policy to allow SELECT
  -- when a corresponding order_offers row exists for auth.uid().
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'orders'
      AND policyname = 'Providers can view offered orders'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "Providers can view offered orders"
      ON public.orders
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.order_offers oo
          WHERE oo.order_id = orders.id
            AND oo.provider_id = auth.uid()
        )
      );
    $pol$;
  END IF;
END $$;

