import { computeDeliveryFee } from "@/lib/pricing";

export type HomeOrderPriceLockSlice = {
  customer_service_price?: number | null;
  delivery_fee?: number | null;
  addons_customer_total?: number | null;
  customer_total?: number | null;
  delivery_km?: number | null;
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Locked service price only — never subtract provider-distance delivery from order total. */
export function resolveCustomerServicePrice(
  lock: HomeOrderPriceLockSlice | null | undefined,
  orderPrice = 0,
): number {
  const addonsCustomer = Math.round(Number(lock?.addons_customer_total) || 0);
  const lockedDelivery = roundMoney(Number(lock?.delivery_fee) || 0);
  const lockedTotal = roundMoney(Number(lock?.customer_total) || 0);
  const lockedService = roundMoney(Number(lock?.customer_service_price) || 0);
  const orderTotal = roundMoney(Number(orderPrice) || 0);

  if (lockedService > 0) {
    const withLockedDelivery = lockedService + addonsCustomer + lockedDelivery;
    if (lockedTotal > 0 && Math.abs(withLockedDelivery - lockedTotal) <= 1) {
      return lockedService;
    }
    if (orderTotal > 0 && Math.abs(withLockedDelivery - orderTotal) <= 1) {
      return lockedService;
    }
    if (
      orderTotal > 0 &&
      lockedDelivery > 0 &&
      Math.abs(lockedService - orderTotal) <= 1
    ) {
      return roundMoney(
        Math.max(0, orderTotal - addonsCustomer - lockedDelivery),
      );
    }
    return lockedService;
  }

  const baseTotal = lockedTotal > 0 ? lockedTotal : orderTotal;
  if (baseTotal > 0 && lockedDelivery > 0) {
    return roundMoney(Math.max(0, baseTotal - addonsCustomer - lockedDelivery));
  }
  if (baseTotal > 0) {
    return roundMoney(Math.max(0, baseTotal - addonsCustomer));
  }
  return 0;
}

/** Booking-time delivery fee from lock fields (not provider distance). */
export function resolveBookingDeliveryFee(
  lock: HomeOrderPriceLockSlice | null | undefined,
): number {
  const lockedDelivery = roundMoney(Number(lock?.delivery_fee) || 0);
  if (lockedDelivery > 0) return lockedDelivery;
  const bookingKm = Number(lock?.delivery_km);
  if (Number.isFinite(bookingKm) && bookingKm >= 0) {
    return computeDeliveryFee(bookingKm, true);
  }
  return computeDeliveryFee(1, true);
}

/**
 * When price lock is unavailable (provider RLS), derive service from order total
 * by subtracting booking-time delivery — never provider-distance delivery.
 */
export function resolveServicePriceFromOrderTotal(
  orderPrice: number,
  mode: "home" | "provider",
  lock: HomeOrderPriceLockSlice | null | undefined,
  addonsCustomer = 0,
): number {
  const orderTotal = roundMoney(Number(orderPrice) || 0);
  if (orderTotal <= 0) return 0;
  if (mode !== "home") return roundMoney(Math.max(0, orderTotal - addonsCustomer));

  const fromLock = resolveCustomerServicePrice(lock, orderTotal);
  if (fromLock > 0 && Math.abs(fromLock - orderTotal) > 1) {
    return fromLock;
  }

  const bookingDelivery = resolveBookingDeliveryFee(lock);
  return roundMoney(Math.max(0, orderTotal - addonsCustomer - bookingDelivery));
}

/** Customer total = locked service + addons + delivery at provider distance. */
export function homeOrderCustomerTotal(
  lock: HomeOrderPriceLockSlice | null | undefined,
  orderPrice: number,
  deliveryKm: number | null | undefined,
): number {
  const addons = Math.round(Number(lock?.addons_customer_total) || 0);
  const service = resolveCustomerServicePrice(lock, orderPrice);
  const delivery =
    deliveryKm != null && Number.isFinite(deliveryKm) && deliveryKm >= 0
      ? computeDeliveryFee(deliveryKm, true)
      : roundMoney(Number(lock?.delivery_fee) || 0);
  return roundMoney(service + addons + delivery);
}
