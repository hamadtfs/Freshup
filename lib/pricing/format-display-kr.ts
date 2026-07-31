import { DELIVERY_FEE_BASE, DELIVERY_FEE_PER_KM } from "./constants";

/** Display-only: 10 NOK ≈ $1 in English UI. Stripe still charges NOK. */
export const NOK_PER_DISPLAY_USD = 10;

export type DisplayLanguage = "en" | "no";

/** Whole-kroner amounts for UI (internal pricing may keep øre precision). */
export function roundDisplayKr(amount: number): number {
  const value = Number(amount);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

export function roundDisplayUsdFromKr(amountKr: number): number {
  return Math.round(roundDisplayKr(amountKr) / NOK_PER_DISPLAY_USD);
}

export function formatDisplayKr(amount: number): string {
  return `${roundDisplayKr(amount)} kr`;
}

export function formatDisplayUsdFromKr(amountKr: number): string {
  return `$${roundDisplayUsdFromKr(amountKr)}`;
}

export function formatDisplayPrice(
  amountKr: number,
  language: DisplayLanguage = "no",
): string {
  return language === "en"
    ? formatDisplayUsdFromKr(amountKr)
    : formatDisplayKr(amountKr);
}

/** Home-delivery rate label for booking UI. */
export function formatDeliveryRateLabel(language: DisplayLanguage = "no"): string {
  if (language === "en") {
    return `$${roundDisplayUsdFromKr(DELIVERY_FEE_BASE)} + $${roundDisplayUsdFromKr(DELIVERY_FEE_PER_KM)}/km`;
  }
  return `${DELIVERY_FEE_BASE} kr + ${DELIVERY_FEE_PER_KM} kr/km`;
}
