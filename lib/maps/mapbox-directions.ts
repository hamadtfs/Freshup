import type { LatLng } from "@/lib/geo";
import { getMapboxServerAccessToken } from "@/lib/maps/mapbox-config";

type MapboxDirectionsJson = {
  routes?: Array<{
    distance?: number;
    geometry?: { coordinates?: [number, number][] };
  }>;
  code?: string;
};

function directionsUrl(
  from: LatLng,
  to: LatLng,
  token: string,
  overview: "false" | "full",
) {
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const params = new URLSearchParams({
    access_token: token,
    geometries: "geojson",
    overview,
  });
  return `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?${params}`;
}

async function fetchMapboxDirectionsJson(
  from: LatLng,
  to: LatLng,
  overview: "false" | "full",
): Promise<MapboxDirectionsJson | null> {
  const token = getMapboxServerAccessToken();
  if (!token) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(directionsUrl(from, to, token, overview), {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as MapboxDirectionsJson;
    if (json.code && json.code !== "Ok") return null;
    return json;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Driving distance in km via Mapbox Directions (server-only). */
export async function fetchMapboxDrivingDistanceKm(
  from: LatLng,
  to: LatLng,
): Promise<number | null> {
  const json = await fetchMapboxDirectionsJson(from, to, "false");
  const meters = Number(json?.routes?.[0]?.distance);
  if (!Number.isFinite(meters) || meters <= 0) return null;
  return Math.round((meters / 1000) * 10) / 10;
}

export async function fetchMapboxDrivingRoute(
  from: LatLng,
  to: LatLng,
): Promise<LatLng[] | null> {
  const json = await fetchMapboxDirectionsJson(from, to, "full");
  const coords = json?.routes?.[0]?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  return coords.map(([lng, lat]) => ({ lat, lng }));
}
