-- New enum labels cannot be used in the same transaction as ALTER TYPE ... ADD VALUE (SQLSTATE 55P04).
-- This migration only extends the type; data + RPC follow in 20260421183100_*.
-- Idempotent if `assigned` already exists (e.g. after a failed combined migration).

DO $do$
BEGIN
  ALTER TYPE public.order_status ADD VALUE 'assigned';
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END
$do$;
