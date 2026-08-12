const LOCK_TTL_MS = 15 * 60 * 1000;

export type OrphanedAuthLockRow = {
  id: string;
  customer_id: string;
  order_id?: string | null;
  stripe_payment_intent_id?: string | null;
  payment_authorized_at?: string | null;
  payment_captured_at?: string | null;
  payment_status?: string | null;
  expires_at?: string | null;
  locked_at?: string | null;
};

function isCanceledStatus(status: string | null | undefined): boolean {
  const value = String(status || "").toLowerCase();
  return value === "canceled" || value === "cancelled";
}

/** Authorised hold, no order, lock already expired — safe to cancel the PI. */
export function isExpiredOrphanedAuthorizedLock(
  row: OrphanedAuthLockRow,
  nowMs: number = Date.now(),
): boolean {
  if (row.order_id) return false;
  if (!row.payment_authorized_at) return false;
  if (row.payment_captured_at) return false;
  if (!row.stripe_payment_intent_id) return false;
  if (isCanceledStatus(row.payment_status)) return false;

  const expiresAt = new Date(String(row.expires_at || "")).getTime();
  if (Number.isFinite(expiresAt)) return expiresAt < nowMs;

  const lockedAt = new Date(
    String(row.locked_at || row.payment_authorized_at),
  ).getTime();
  return Number.isFinite(lockedAt) && lockedAt + LOCK_TTL_MS < nowMs;
}
