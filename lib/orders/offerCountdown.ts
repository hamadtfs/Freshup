import { DISPATCH_PROVIDER_OFFER_TTL_MS } from "@/lib/orders/dispatchTiming";

const DEFAULT_SECONDS = Math.round(DISPATCH_PROVIDER_OFFER_TTL_MS / 1000);

/** Seconds left on an offer for UI; each provider's window is from their own `expires_at`. */
export function offerCountdownSeconds(
  expiresAtIso: string | null | undefined,
  nowMs = Date.now(),
): number {
  if (!expiresAtIso) return DEFAULT_SECONDS;
  const expiresMs = new Date(expiresAtIso).getTime();
  if (!Number.isFinite(expiresMs)) return DEFAULT_SECONDS;
  return Math.max(
    0,
    Math.min(120, Math.ceil((expiresMs - nowMs) / 1000)),
  );
}
