import { computeDeliveryFee } from "../pricing/engine";
import { MAX_DISPATCH_MATCH_RADIUS_KM } from "../orders/dispatch-radius";

/**
 * Worst-case delivery fee for auth holds: fee at the max dispatch match radius.
 * Example at 10 km: max(160, 150 + 10×10) = 250 kr.
 */
export function maxDeliveryFeeAtDispatchRadius(
  maxRadiusKm: number = MAX_DISPATCH_MATCH_RADIUS_KM,
): number {
  const km = Math.max(0, Number(maxRadiusKm) || 0);
  return computeDeliveryFee(km, true);
}
