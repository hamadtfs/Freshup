import type { SupabaseClient } from "@supabase/supabase-js";
import { releaseBookingPaymentByLock } from "./order-payment";
import {
  isExpiredOrphanedAuthorizedLock,
  type OrphanedAuthLockRow,
} from "./orphaned-auth-lock-match";

export {
  isExpiredOrphanedAuthorizedLock,
  type OrphanedAuthLockRow,
} from "./orphaned-auth-lock-match";

const DEFAULT_LIMIT = 50;

export type OrphanedAuthCleanupResult = {
  scanned: number;
  released: number;
  skipped: number;
  errors: Array<{ id: string; error: string }>;
  locks: Array<{
    id: string;
    customer_id: string;
    authorized_at: string | null;
    expires_at: string | null;
    payment_status: string | null;
    stripe_payment_intent_id: string | null;
  }>;
};

export async function listExpiredOrphanedAuthorizedLocks(
  supabase: SupabaseClient,
  limit: number = DEFAULT_LIMIT,
): Promise<OrphanedAuthLockRow[]> {
  const { data, error } = await supabase
    .from("booking_price_locks")
    .select(
      "id, customer_id, order_id, stripe_payment_intent_id, payment_authorized_at, payment_captured_at, payment_status, expires_at, locked_at",
    )
    .is("order_id", null)
    .not("payment_authorized_at", "is", null)
    .is("payment_captured_at", null)
    .not("stripe_payment_intent_id", "is", null)
    .order("payment_authorized_at", { ascending: true })
    .limit(Math.max(1, Math.min(limit, 200)));

  if (error) throw new Error(error.message);

  const nowMs = Date.now();
  return ((data ?? []) as OrphanedAuthLockRow[]).filter((row) =>
    isExpiredOrphanedAuthorizedLock(row, nowMs),
  );
}

/**
 * Cancel Stripe holds on expired price locks that never became an order.
 * Includes the known 8 Jul / 22 Jul 2026 orphans once they are still authorised.
 */
export async function cleanupOrphanedAuthorizedLocks(
  supabase: SupabaseClient,
  options?: { dryRun?: boolean; limit?: number },
): Promise<OrphanedAuthCleanupResult> {
  const dryRun = Boolean(options?.dryRun);
  const locks = await listExpiredOrphanedAuthorizedLocks(
    supabase,
    options?.limit ?? DEFAULT_LIMIT,
  );

  const result: OrphanedAuthCleanupResult = {
    scanned: locks.length,
    released: 0,
    skipped: 0,
    errors: [],
    locks: locks.map((row) => ({
      id: row.id,
      customer_id: row.customer_id,
      authorized_at: row.payment_authorized_at ?? null,
      expires_at: row.expires_at ?? null,
      payment_status: row.payment_status ?? null,
      stripe_payment_intent_id: row.stripe_payment_intent_id ?? null,
    })),
  };

  if (dryRun) {
    result.skipped = locks.length;
    return result;
  }

  for (const row of locks) {
    try {
      await releaseBookingPaymentByLock(supabase, row.id, row.customer_id);
      result.released += 1;
    } catch (e) {
      result.errors.push({
        id: row.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}
