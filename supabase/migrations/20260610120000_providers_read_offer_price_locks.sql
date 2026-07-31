-- Providers need booking_price_locks for orders they have been offered so the
-- client can show service price vs delivery without routing every offer through
-- an API. (Offer-pricing API remains the canonical path for service role reads.)

drop policy if exists "bpl_provider_select_offered_order" on public.booking_price_locks;
create policy "bpl_provider_select_offered_order"
  on public.booking_price_locks for select
  using (
    exists (
      select 1
      from public.order_offers oo
      where oo.order_id = booking_price_locks.order_id
        and oo.provider_id = auth.uid()
        and oo.status in ('pending', 'accepted')
    )
  );
