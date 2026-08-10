/** Round NOK amounts to 25 kr steps (Munib: never store 447 kr). */
export const PRICE_SNAP_KR = 25;

export function snapPriceKr(
  value: number,
  step: number = PRICE_SNAP_KR,
): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const s = step > 0 ? step : PRICE_SNAP_KR;
  return Math.round(n / s) * s;
}

/** Floor/ceil range endpoints onto the snap grid (keep span usable). */
export function snapPriceRangeKr(
  min: number,
  max: number,
  step: number = PRICE_SNAP_KR,
): { min: number; max: number } {
  const s = step > 0 ? step : PRICE_SNAP_KR;
  let lo = Math.floor(Number(min) / s) * s;
  let hi = Math.ceil(Number(max) / s) * s;
  if (!Number.isFinite(lo)) lo = 0;
  if (!Number.isFinite(hi)) hi = lo + s;
  if (hi <= lo) hi = lo + s;
  return { min: lo, max: hi };
}
