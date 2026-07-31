import type { LatLng } from "@/lib/geo";

/**
 * Public OSRM demo router (no API key). Falls back to straight line in callers.
 * Replace with Mapbox Directions when client token is available.
 */
function osrmDrivingUrl(from: LatLng, to: LatLng, overview: "false" | "full") {
  return (
    `https://router.project-osrm.org/route/v1/driving/` +
    `${from.lng},${from.lat};${to.lng},${to.lat}` +
    `?overview=${overview}&geometries=geojson`
  );
}

async function fetchOsrmRouteJson(
  from: LatLng,
  to: LatLng,
  overview: "false" | "full",
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(osrmDrivingUrl(from, to, overview), {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      routes?: Array<{
        distance?: number;
        geometry?: { coordinates?: [number, number][] };
      }>;
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Driving distance in km (public OSRM). Replace with Mapbox Directions when token exists. */
export async function fetchOsrmDrivingDistanceKm(
  from: LatLng,
  to: LatLng,
): Promise<number | null> {
  const json = await fetchOsrmRouteJson(from, to, "false");
  const meters = Number(json?.routes?.[0]?.distance);
  if (!Number.isFinite(meters) || meters <= 0) return null;
  return Math.round((meters / 1000) * 10) / 10;
}

export async function fetchOsrmDrivingRoute(
  from: LatLng,
  to: LatLng,
): Promise<LatLng[] | null> {
  const json = await fetchOsrmRouteJson(from, to, "full");
  const coords = json?.routes?.[0]?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  return coords.map(([lng, lat]) => ({ lat, lng }));
}
