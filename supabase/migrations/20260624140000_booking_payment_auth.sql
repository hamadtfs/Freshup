-- Payment auth/capture fields on booking price locks (reserve at confirm, capture at match).

alter table public.booking_price_locks
  add column if not exists stripe_payment_intent_id text,
  add column if not exists payment_authorized_amount numeric(12, 2),
  add column if not exists payment_authorized_at timestamptz,
  add column if not exists payment_captured_amount numeric(12, 2),
  add column if not exists payment_captured_at timestamptz,
  add column if not exists payment_status text;

comment on column public.booking_price_locks.payment_authorized_amount is
  'Manual-capture hold placed at confirm (service + addons + max delivery ceiling for home).';

create index if not exists idx_booking_price_locks_stripe_pi
  on public.booking_price_locks (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;
