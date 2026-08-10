import { DELIVERY_FEE_BASE, DELIVERY_FEE_PER_KM } from "./constants";

/**
 * Display currency follows the GPS/pricing area (spec), not UI language.
 * All live markets are Norway → NOK. Language only affects copy, never $ conversion.
 * Stripe and provider_price_inputs remain NOK.
 */
export type DisplayCurrency = "NOK";

/** @deprecated Kept so callers compiling against the old USD display helpers still typecheck. */
export const NOK_PER_DISPLAY_USD = 10;

export type DisplayLanguage = "en" | "no";

/** Whole-kroner amounts for UI (internal pricing may keep øre precision). */
export function roundDisplayKr(amount: number): number {
  const value = Number(amount);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

/** @deprecated Do not use for UI — was language-tied and corrupted signup amounts. */
export function roundDisplayUsdFromKr(amountKr: number): number {
  return Math.round(roundDisplayKr(amountKr) / NOK_PER_DISPLAY_USD);
}

export function formatDisplayKr(amount: number): string {
  return `${roundDisplayKr(amount)} kr`;
}

/** @deprecated Prefer formatDisplayKr / formatDisplayPrice. */
export function formatDisplayUsdFromKr(amountKr: number): string {
  return formatDisplayKr(amountKr);
}

/**
 * Format a NOK amount for UI. `language` is ignored for currency (area = NOK).
 * Kept in the signature so existing call sites need no churn.
 */
export function formatDisplayPrice(
  amountKr: number,
  _language: DisplayLanguage = "no",
  currency: DisplayCurrency = "NOK",
): string {
  void _language;
  void currency;
  return formatDisplayKr(amountKr);
}

/** Home-delivery rate label — always NOK for current markets. */
export function formatDeliveryRateLabel(
  _language: DisplayLanguage = "no",
): string {
  void _language;
  return `${DELIVERY_FEE_BASE} kr + ${DELIVERY_FEE_PER_KM} kr/km`;
}
