-- One-off: boost provider 8a086479-1a06-4ea8-bf23-97d43c8511c1 to Gold (score 70+).
-- Run manually in Supabase SQL editor (service role / postgres).

BEGIN;

UPDATE public.provider_details
SET dispatch_performance_tier = 'gold'
WHERE id = '8a086479-1a06-4ea8-bf23-97d43c8511c1';

-- Fast accepts on all offers in the 30-day performance window.
UPDATE public.order_offers
SET
  status = 'accepted',
  responded_at = created_at + interval '2 seconds'
WHERE provider_id = '8a086479-1a06-4ea8-bf23-97d43c8511c1'
  AND created_at >= now() - interval '30 days';

-- Complete orders tied to those accepted offers (raises completion rate).
UPDATE public.orders o
SET
  status = 'completed',
  completed_at = coalesce(o.completed_at, o.accepted_at, now() - interval '1 day'),
  provider_id = coalesce(o.provider_id, '8a086479-1a06-4ea8-bf23-97d43c8511c1'::uuid)
FROM public.order_offers oo
WHERE oo.order_id = o.id
  AND oo.provider_id = '8a086479-1a06-4ea8-bf23-97d43c8511c1'
  AND oo.status = 'accepted'
  AND oo.created_at >= now() - interval '30 days'
  AND o.status IS DISTINCT FROM 'completed';

-- Any other in-window jobs for this provider → completed.
UPDATE public.orders
SET
  status = 'completed',
  completed_at = coalesce(completed_at, accepted_at, now() - interval '1 day')
WHERE provider_id = '8a086479-1a06-4ea8-bf23-97d43c8511c1'
  AND status IN ('assigned', 'en_route', 'in_progress', 'offered', 'accepted')
  AND coalesce(accepted_at, created_at) >= now() - interval '30 days';

COMMIT;
