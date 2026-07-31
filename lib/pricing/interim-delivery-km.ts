/**
 * Straight-line fallback when OSRM is unavailable.
 * Primary path: `lib/pricing/home-delivery-km.ts` + GET /api/pricing/delivery-km.
 */

import { haversineKm, type LatLng } from "@/lib/geo";
import { resolvePricingAreaDefinition } from "@/lib/pricing/areas";

const OSLO_CENTER: LatLng = { lat: 59.9139, lng: 10.7522 };
/** Default delivery km while searching (before a provider is assigned). */
export const DEFAULT_SEARCH_DELIVERY_KM = 1;
/** Minimum km so delivery fee is not base-only by mistake. */
const MIN_INTERIM_KM = DEFAULT_SEARCH_DELIVERY_KM;
const MAX_INTERIM_KM = 25;

/**
 * Estimate km from customer pin to local market centre (straight-line).
 * Replace with Mapbox driving distance when token is available.
 */
export function estimateInterimHomeDeliveryKm(customer: LatLng): number {
  const area = resolvePricingAreaDefinition(customer);
  const center = area?.center ?? OSLO_CENTER;
  const km = haversineKm(customer, center);
  const rounded = Math.round(km * 10) / 10;
  return Math.min(MAX_INTERIM_KM, Math.max(MIN_INTERIM_KM, rounded));
}
