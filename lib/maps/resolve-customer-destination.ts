import { haversineKm, type LatLng } from "@/lib/geo";

export type CustomerDestinationSource =
  | "order"
  | "live"
  | "order_match"
  | "live_match"
  | "none";

function isValidCoord(p: LatLng | null | undefined): p is LatLng {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng);
}

/** Pick the customer delivery pin for the provider map / driving route. */
export function resolveCustomerDestination(
  orderLoc: LatLng | null | undefined,
  liveLoc: LatLng | null | undefined,
  providerLoc: LatLng | null | undefined,
  matchDistanceKm?: number | null,
): { destination: LatLng | null; source: CustomerDestinationSource } {
  const order = isValidCoord(orderLoc) ? orderLoc : null;
  const live = isValidCoord(liveLoc) ? liveLoc : null;
  const provider = isValidCoord(providerLoc) ? providerLoc : null;

  if (!provider) {
    const destination = order ?? live;
    return {
      destination,
      source: destination ? (order ? "order" : "live") : "none",
    };
  }

  const candidates: Array<{ loc: LatLng; source: CustomerDestinationSource }> =
    [];
  if (order) candidates.push({ loc: order, source: "order" });
  if (live) candidates.push({ loc: live, source: "live" });

  if (candidates.length === 0) {
    return { destination: null, source: "none" };
  }

  const expectedKm =
    matchDistanceKm != null &&
    Number.isFinite(matchDistanceKm) &&
    matchDistanceKm > 0.3
      ? matchDistanceKm
      : null;

  if (expectedKm != null) {
    let best = candidates[0]!;
    let bestDelta = Math.abs(haversineKm(best.loc, provider) - expectedKm);
    for (const candidate of candidates.slice(1)) {
      const delta = Math.abs(
        haversineKm(candidate.loc, provider) - expectedKm,
      );
      if (delta < bestDelta) {
        best = candidate;
        bestDelta = delta;
      }
    }
    const bestDist = haversineKm(best.loc, provider);
    if (
      bestDist > 0.35 ||
      bestDelta <= Math.max(0.6, expectedKm * 0.35)
    ) {
      return {
        destination: best.loc,
        source: best.source === "order" ? "order_match" : "live_match",
      };
    }
  }

  const orderDist = order ? haversineKm(order, provider) : 0;
  const liveDist = live ? haversineKm(live, provider) : 0;

  if (order && live) {
    if (orderDist < 0.4 && liveDist > 0.4) {
      return { destination: live, source: "live" };
    }
    if (liveDist < 0.4 && orderDist > 0.4) {
      return { destination: order, source: "order" };
    }
    return orderDist >= liveDist
      ? { destination: order, source: "order" }
      : { destination: live, source: "live" };
  }

  const only = candidates[0]!;
  return { destination: only.loc, source: only.source };
}

/** Booked order delivery coords for provider map/route (no live GPS). */
export function providerHomeDeliveryPin(
  orderLoc: LatLng | null | undefined,
): LatLng | null {
  return isValidCoord(orderLoc) ? orderLoc : null;
}

/** Provider map customer pin — mirror customer-side map (live GPS when far, else booked address). */
export function providerMapCustomerPin(
  orderLoc: LatLng | null | undefined,
  liveLoc: LatLng | null | undefined,
  providerLoc: LatLng | null | undefined,
  matchDistanceKm?: number | null,
): LatLng | null {
  const order = isValidCoord(orderLoc) ? orderLoc : null;
  const live = isValidCoord(liveLoc) ? liveLoc : null;
  const provider = isValidCoord(providerLoc) ? providerLoc : null;

  if (live && provider && haversineKm(live, provider) >= 0.5) {
    return live;
  }

  if (order && provider && haversineKm(order, provider) >= 0.5) {
    return order;
  }

  const expectedKm =
    matchDistanceKm != null &&
    Number.isFinite(matchDistanceKm) &&
    matchDistanceKm > 0.5
      ? matchDistanceKm
      : null;

  if (expectedKm != null && provider) {
    const resolved = resolveCustomerDestination(
      order,
      live,
      provider,
      expectedKm,
    );
    if (
      resolved.destination &&
      haversineKm(resolved.destination, provider) >= 0.5
    ) {
      return resolved.destination;
    }
  }

  return order ?? live ?? null;
}

/** Route/map origin for home delivery — shop base unless live GPS is clearly en route. */
export function resolveProviderNavigationOrigin(
  baseLoc: LatLng | null | undefined,
  liveLoc: LatLng | null | undefined,
  customerLoc: LatLng | null | undefined,
  matchDistanceKm?: number | null,
): LatLng | null {
  const base = isValidCoord(baseLoc) ? baseLoc : null;
  const live = isValidCoord(liveLoc) ? liveLoc : null;
  const customer = isValidCoord(customerLoc) ? customerLoc : null;

  if (!base && !live) return null;
  if (!live) return base;
  if (!customer) return live ?? base;

  const liveToCustomer = haversineKm(live, customer);
  const baseToCustomer = base ? haversineKm(base, customer) : null;
  const matchKm =
    matchDistanceKm != null &&
    Number.isFinite(matchDistanceKm) &&
    matchDistanceKm > 0.5
      ? matchDistanceKm
      : null;

  if (
    base &&
    matchKm != null &&
    liveToCustomer < 0.5 &&
    baseToCustomer != null &&
    baseToCustomer >= Math.max(1, matchKm * 0.45)
  ) {
    return base;
  }

  return live ?? base;
}

export function parseOfferDistanceKm(
  distanceText: string | undefined,
  matchDistanceKm?: number | null,
): number | null {
  if (
    matchDistanceKm != null &&
    Number.isFinite(matchDistanceKm) &&
    matchDistanceKm >= 0
  ) {
    return matchDistanceKm;
  }
  const match = String(distanceText || "").match(/([\d.]+)/);
  if (!match) return null;
  const km = Number(match[1]);
  return Number.isFinite(km) && km >= 0 ? km : null;
}
