import type { LatLng } from "@/lib/geo";
import type { DrivingRouteSource } from "@/lib/maps/driving-route";

/** Browser helper — hits server route so Mapbox token stays off the client. */
export async function fetchDrivingRoutePolylineClient(
  from: LatLng,
  to: LatLng,
): Promise<{ coordinates: LatLng[]; source: DrivingRouteSource } | null> {
  const url = new URL("/api/maps/driving-route", window.location.origin);
  url.searchParams.set("from_lat", String(from.lat));
  url.searchParams.set("from_lng", String(from.lng));
  url.searchParams.set("to_lat", String(to.lat));
  url.searchParams.set("to_lng", String(to.lng));

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      coordinates?: LatLng[];
      source?: DrivingRouteSource;
    };
    const coordinates = data.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
    return {
      coordinates,
      source: data.source === "mapbox" ? "mapbox" : "osrm",
    };
  } catch {
    return null;
  }
}
