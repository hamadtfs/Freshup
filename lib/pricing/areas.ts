/**
 * FreshUp pricing areas (spec §2.1):
 *
 * GPS at signup resolves to a local market bucket — not a manual city pick.
 * Named launch cities (Oslo, Bergen, …) win when the pin is inside their
 * radius; otherwise we snap to a nearby coordinate cell so Lahore, Oslo, and
 * any other pin each keep their own prices without sharing a global bucket.
 */

import { haversineKm, type LatLng } from "@/lib/geo";

export interface PricingArea {
  /** Stable id used as foreign key in pricing tables. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** ISO country code (FreshUp launches in Norway). */
  country: string;
  /** Approximate municipal centre. */
  center: LatLng;
  /** Radius in km within which a provider GPS counts as "in this area". */
  radiusKm: number;
}

/** Grid step for auto-created local markets (~22 km latitude). */
export const DYNAMIC_PRICING_CELL_DEGREES = 0.2;

/** Radius used when registering a GPS-derived pricing cell. */
export const DYNAMIC_PRICING_RADIUS_KM = 25;

export const NORWEGIAN_AREAS: PricingArea[] = [
  { id: "oslo", name: "Oslo", country: "NO", center: { lat: 59.9139, lng: 10.7522 }, radiusKm: 25 },
  { id: "bergen", name: "Bergen", country: "NO", center: { lat: 60.3913, lng: 5.3221 }, radiusKm: 25 },
  { id: "trondheim", name: "Trondheim", country: "NO", center: { lat: 63.4305, lng: 10.3951 }, radiusKm: 25 },
  { id: "stavanger", name: "Stavanger", country: "NO", center: { lat: 58.9700, lng: 5.7331 }, radiusKm: 25 },
  { id: "kristiansand", name: "Kristiansand", country: "NO", center: { lat: 58.1467, lng: 7.9956 }, radiusKm: 25 },
  { id: "drammen", name: "Drammen", country: "NO", center: { lat: 59.7440, lng: 10.2045 }, radiusKm: 20 },
  { id: "fredrikstad", name: "Fredrikstad", country: "NO", center: { lat: 59.2181, lng: 10.9298 }, radiusKm: 20 },
  { id: "tromso", name: "Tromsø", country: "NO", center: { lat: 69.6492, lng: 18.9553 }, radiusKm: 25 },
  { id: "alesund", name: "Ålesund", country: "NO", center: { lat: 62.4722, lng: 6.1495 }, radiusKm: 20 },
  { id: "bodo", name: "Bodø", country: "NO", center: { lat: 67.2804, lng: 14.4049 }, radiusKm: 20 },
];

/** Special area id used when coordinates are missing or invalid. */
export const UNKNOWN_AREA_ID = "unknown";

function snapToPricingGrid(value: number, step = DYNAMIC_PRICING_CELL_DEGREES): number {
  return Math.round(value / step) * step;
}

function pricingCoordToken(value: number): string {
  return value.toFixed(2).replace(/-/g, "n").replace(/\./g, "d");
}

/** Build a stable local-market bucket for coordinates outside named cities. */
export function buildDynamicPricingArea(lat: number, lng: number): PricingArea {
  const centerLat = snapToPricingGrid(lat);
  const centerLng = snapToPricingGrid(lng);
  const id = `gps_${pricingCoordToken(centerLat)}_${pricingCoordToken(centerLng)}`;
  return {
    id,
    name: `Local market ${centerLat.toFixed(2)}, ${centerLng.toFixed(2)}`,
    country: "XX",
    center: { lat: centerLat, lng: centerLng },
    radiusKm: DYNAMIC_PRICING_RADIUS_KM,
  };
}

/** Named city match, otherwise a GPS-derived local market cell. */
export function resolvePricingAreaDefinition(
  coords: LatLng | null | undefined,
): PricingArea | null {
  if (!coords || typeof coords.lat !== "number" || typeof coords.lng !== "number") {
    return null;
  }
  return resolveAreaForCoords(coords) ?? buildDynamicPricingArea(coords.lat, coords.lng);
}

/**
 * Map a GPS coordinate to a known pricing area id.
 * Returns the closest area whose centroid is within its `radiusKm`,
 * or `UNKNOWN_AREA_ID` if none match.
 *
 * This is a *pure* function — it doesn't read `pricing_areas` from the DB,
 * so it can run in client code (signup form preview) and on the server.
 *
 * Server code MUST also persist the resolved area into `pricing_areas`
 * if it isn't already there — this function only resolves, it doesn't insert.
 */
export function resolveAreaForCoords(
  coords: LatLng | null | undefined,
  areas: PricingArea[] = NORWEGIAN_AREAS,
): PricingArea | null {
  if (!coords || typeof coords.lat !== "number" || typeof coords.lng !== "number") {
    return null;
  }
  let best: { area: PricingArea; distance: number } | null = null;
  for (const area of areas) {
    const distance = haversineKm(coords, area.center);
    if (distance > area.radiusKm) continue;
    if (best == null || distance < best.distance) {
      best = { area, distance };
    }
  }
  return best?.area ?? null;
}

/** Convenience helper — returns the area id (or `UNKNOWN_AREA_ID`). */
export function resolveAreaId(coords: LatLng | null | undefined): string {
  return resolvePricingAreaDefinition(coords)?.id ?? UNKNOWN_AREA_ID;
}
