/**
 * Mapbox token resolution. Directions run server-side; map tiles use NEXT_PUBLIC_*.
 * When no token is set, callers fall back to OSRM / CARTO.
 */

/** Server routes (Directions API) — prefer secret, allow public for local dev only. */
export function getMapboxServerAccessToken(): string | null {
  const token =
    process.env.MAPBOX_ACCESS_TOKEN?.trim() ||
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim() ||
    "";
  return token || null;
}

/** Client map (MapLibre + Mapbox style URL). */
export function getMapboxPublicAccessToken(): string | null {
  const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim() || "";
  return token || null;
}

export function isMapboxDirectionsEnabled(): boolean {
  return getMapboxServerAccessToken() != null;
}

export function isMapboxMapEnabled(): boolean {
  return getMapboxPublicAccessToken() != null;
}
