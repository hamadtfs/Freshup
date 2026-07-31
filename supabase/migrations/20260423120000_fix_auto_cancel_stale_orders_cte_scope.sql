-- Fix auto-cancel function: avoid CTE scope leakage across statements.
-- Previous version referenced `upd` outside its statement, causing runtime
-- failures and rollback (orders remained pending/offered).

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
  -- 1) Cancel stale orders and capture ids.
  WITH stale AS (
    SELECT o.id
    FROM public.orders o
    WHERE o.provider_id IS NULL
      AND o.status IN ('pending'::public.order_status, 'offered'::public.order_status)
      AND o.created_at < (now_ts - interval '2 minutes')
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

  -- 2) Expire any pending offers tied to cancelled orders.
  UPDATE public.order_offers oo
  SET status = 'expired',
      responded_at = now_ts
  WHERE oo.order_id = ANY(stale_order_ids)
    AND oo.status = 'pending';

  -- 3) Emit events (best-effort; do not fail cancellation if this insert fails).
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

-- Ensure the cron job exists and points to the corrected function.
DO $$
DECLARE
  existing_job_id int;
BEGIN
  SELECT jobid INTO existing_job_id
  FROM cron.job
  WHERE jobname = 'cancel_stale_unassigned_orders_every_minute'
  LIMIT 1;

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;

  PERFORM cron.schedule(
    'cancel_stale_unassigned_orders_every_minute',
    '* * * * *',
    $cron$select public.cancel_stale_unassigned_orders();$cron$
  );
END $$;
