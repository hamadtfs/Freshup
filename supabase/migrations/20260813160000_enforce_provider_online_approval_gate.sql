-- Hard-enforce go-online / dispatch eligibility on provider_details.is_online.
-- Incomplete signup (no Stripe payouts, no admin approve) cannot stay online.
-- Apply manually — do not run from the agent.

CREATE OR REPLACE FUNCTION public.provider_is_dispatch_eligible(
  p_stripe_payouts_enabled boolean,
  p_admin_approved boolean
) RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(p_stripe_payouts_enabled, false)
     AND coalesce(p_admin_approved, false);
$$;

CREATE OR REPLACE FUNCTION public.provider_details_enforce_online_gate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_online IS TRUE
     AND NOT public.provider_is_dispatch_eligible(
       NEW.stripe_payouts_enabled,
       NEW.admin_approved
     ) THEN
    NEW.is_online := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS provider_details_enforce_online_gate ON public.provider_details;
CREATE TRIGGER provider_details_enforce_online_gate
  BEFORE INSERT OR UPDATE OF is_online, stripe_payouts_enabled, admin_approved
  ON public.provider_details
  FOR EACH ROW
  EXECUTE FUNCTION public.provider_details_enforce_online_gate();

-- Knock incomplete / unapproved accounts out of the live pool.
UPDATE public.provider_details
SET
  is_online = false,
  updated_at = now()
WHERE is_online = true
  AND NOT public.provider_is_dispatch_eligible(
    stripe_payouts_enabled,
    admin_approved
  );
