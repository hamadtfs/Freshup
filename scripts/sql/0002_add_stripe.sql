-- Add Stripe Payment Intent id to payments table
alter table if exists payments add column if not exists stripe_payment_intent_id text;

-- Optional: index for quick lookups
create index if not exists idx_payments_pi on payments (stripe_payment_intent_id);
