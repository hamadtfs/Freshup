import { computeQuote } from "./engine";

/**
 * Convert legacy catalog base (services.base_price_* average) to the
 * customer service price shown by quote-bulk / buildQuote.
 * Legacy base is provider-side; quote applies capacity multiplier + commission.
 */
export function legacyProviderBaseToCustomerServicePrice(
  providerLegacyBase: number,
  opts?: {
    usedCapacityPct?: number;
    multiplier?: number | null;
  },
): number {
  const base = Number(providerLegacyBase);
  if (!Number.isFinite(base) || base <= 0) return 0;

  const multiplier = opts?.multiplier;
  const quote = computeQuote({
    providerBasePrice: base,
    usedCapacityPct: opts?.usedCapacityPct ?? 0,
    multiplierOverride:
      multiplier != null && Number.isFinite(multiplier) ? multiplier : undefined,
    isHomeVisit: false,
  });

  return Math.round(quote.customerServicePrice * 100) / 100;
}
