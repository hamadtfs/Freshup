import { computeDeliveryFee } from "../pricing/engine";
import { maxDeliveryFeeAtDispatchRadius } from "./delivery-ceiling";

export type PriceLockPaymentSlice = {
  delivery_mode?: string | null;
  customer_service_price?: number | null;
  addons_customer_total?: number | null;
  customer_total?: number | null;
  delivery_fee?: number | null;
};

function roundKr(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Service + add-ons from a booking price lock (no delivery). */
export function serviceAndAddonsFromLock(
  lock: PriceLockPaymentSlice,
): number {
  const service = roundKr(Number(lock.customer_service_price) || 0);
  const addons = roundKr(Number(lock.addons_customer_total) || 0);
  return roundKr(service + addons);
}

/**
 * Stripe manual-capture authorization amount for a booking lock.
 * Home: service + addons + max delivery at dispatch radius.
 * At-provider: locked customer total (no variable delivery).
 */
export function authorizeAmountFromPriceLock(
  lock: PriceLockPaymentSlice,
  maxDeliveryCeilingKr?: number,
): number {
  const serviceAndAddons = serviceAndAddonsFromLock(lock);
  if (lock.delivery_mode === "home") {
    const ceiling =
      maxDeliveryCeilingKr ?? maxDeliveryFeeAtDispatchRadius();
    return roundKr(serviceAndAddons + ceiling);
  }
  const lockedTotal = roundKr(Number(lock.customer_total) || 0);
  if (lockedTotal > 0) return lockedTotal;
  return serviceAndAddons;
}

/** Exact customer total to capture once provider distance is known. */
export function captureAmountFromPriceLock(
  lock: PriceLockPaymentSlice,
  deliveryKm: number | null | undefined,
  orderPriceFallback = 0,
): number {
  if (lock.delivery_mode !== "home") {
    const lockedTotal = roundKr(Number(lock.customer_total) || 0);
    if (lockedTotal > 0) return lockedTotal;
    return roundKr(Number(orderPriceFallback) || 0);
  }

  const serviceAndAddons = serviceAndAddonsFromLock(lock);
  const km =
    deliveryKm != null && Number.isFinite(deliveryKm) && deliveryKm >= 0
      ? deliveryKm
      : Number(lock.delivery_fee) > 0
        ? null
        : 0;

  if (km != null) {
    return roundKr(serviceAndAddons + computeDeliveryFee(km, true));
  }

  const lockedTotal = roundKr(Number(lock.customer_total) || 0);
  if (lockedTotal > 0) return lockedTotal;
  return roundKr(Number(orderPriceFallback) || 0);
}
