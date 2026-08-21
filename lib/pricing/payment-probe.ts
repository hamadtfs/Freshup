/**
 * Payment-probe service — low fixed amount for live Stripe + booking E2E.
 * Kept on `classic_cut_m` so existing provider_skills continue to match.
 *
 * Catalog visibility is filtered in `/api/services/list` unless `include_probe=1`.
 * Pricing/lock treat this id as always bookable (not market-closed) so testers
 * can finish Confirm → lock → pay without waiting on live supply.
 */
export const PAYMENT_PROBE_SERVICE_ID = "classic_cut_m";

const PROBE_ALIASES = new Set([
  PAYMENT_PROBE_SERVICE_ID,
  "classic-cut",
  "classic-cut-m",
  "classic_cut",
]);

export function isPaymentProbeService(
  serviceId: string | null | undefined,
): boolean {
  const raw = String(serviceId || "")
    .trim()
    .toLowerCase();
  if (!raw) return false;
  if (PROBE_ALIASES.has(raw)) return true;
  const normalized = raw.replace(/-/g, "_");
  return (
    normalized === PAYMENT_PROBE_SERVICE_ID || PROBE_ALIASES.has(normalized)
  );
}
