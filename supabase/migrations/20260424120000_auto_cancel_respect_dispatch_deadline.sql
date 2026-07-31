-- Align auto-cancel with Milestone 3: cancel unassigned hunts only after
-- dispatch_deadline_at (5 min from book), not after a fixed 2 minutes from created_at.
-- Legacy rows without dispatch_deadline_at: use created_at + 5 minutes.

CREATE OR REPLACE FUNCTION public.cancel_stale_unassigned_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  now_ts timestamptz := now();
  affected int := 0;
  stale_order_ids uuid[] := '{}';
BEGIN
  WITH stale AS (
    SELECT o.id
    FROM public.orders o
    WHERE o.provider_id IS NULL
      AND o.status IN ('pending'::public.order_status, 'offered'::public.order_status)
      AND (
        (o.dispatch_deadline_at IS NOT NULL AND now_ts > o.dispatch_deadline_at)
        OR (
          o.dispatch_deadline_at IS NULL
          AND o.created_at < (now_ts - interval '5 minutes')
        )
      )
  ),
  upd AS (
    UPDATE public.orders o
    SET status = 'cancelled'::public.order_status,
        cancelled_at = now_ts,
        cancellation_reason = 'auto_expired_no_provider',
        updated_at = now_ts
    WHERE o.id IN (SELECT id FROM stale)
      AND o.provider_id IS NULL
      AND o.status IN ('pending'::public.order_status, 'offered'::public.order_status)
    RETURNING o.id
  )
  SELECT
    COALESCE(array_agg(u.id), '{}'),
    COUNT(*)
  INTO stale_order_ids, affected
  FROM upd u;

  IF affected = 0 THEN
    RETURN 0;
  END IF;

  UPDATE public.order_offers oo
  SET status = 'expired',
      responded_at = now_ts
  WHERE oo.order_id = ANY(stale_order_ids)
    AND oo.status = 'pending';

  BEGIN
    INSERT INTO public.order_events (order_id, event_type, actor_id, metadata)
    SELECT o.id, 'system_auto_cancelled', o.customer_id, jsonb_build_object('reason', 'auto_expired_no_provider')
    FROM public.orders o
    WHERE o.id = ANY(stale_order_ids);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN affected;
END;
$$;

-- Cron job already scheduled by prior migration; no change to schedule needed.
