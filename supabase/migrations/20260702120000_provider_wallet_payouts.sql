-- Provider wallet & payout flow (Stripe Connect V1)

ALTER TABLE public.payouts
  ADD COLUMN IF NOT EXISTS payout_type text NOT NULL DEFAULT 'automatic',
  ADD COLUMN IF NOT EXISTS fee integer NOT NULL DEFAULT 0;

ALTER TABLE public.payouts
  DROP CONSTRAINT IF EXISTS payouts_payout_type_check;

ALTER TABLE public.payouts
  ADD CONSTRAINT payouts_payout_type_check CHECK (
    payout_type = ANY (ARRAY['automatic'::text, 'instant'::text])
  );

ALTER TABLE public.provider_earnings_ledger
  DROP CONSTRAINT IF EXISTS provider_earnings_ledger_entry_type_check;

ALTER TABLE public.provider_earnings_ledger
  ADD CONSTRAINT provider_earnings_ledger_entry_type_check CHECK (
    entry_type = ANY (
      ARRAY['earning'::text, 'adjustment'::text, 'fee'::text, 'refund'::text, 'payout'::text]
    )
  );

ALTER TABLE public.provider_details
  ADD COLUMN IF NOT EXISTS bank_account_last4 text;

CREATE INDEX IF NOT EXISTS idx_payouts_provider_created
  ON public.payouts (provider_id, created_at DESC);
