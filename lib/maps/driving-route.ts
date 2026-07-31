import type { LatLng } from "@/lib/geo";
import { fetchMapboxDrivingDistanceKm, fetchMapboxDrivingRoute } from "@/lib/maps/mapbox-directions";
import { isMapboxDirectionsEnabled } from "@/lib/maps/mapbox-config";
import {
  fetchOsrmDrivingDistanceKm,
  fetchOsrmDrivingRoute,
} from "@/lib/maps/osrm-route";

export type DrivingRouteSource = "mapbox" | "osrm";

/**
 * Driving distance (km): Mapbox Directions when token is set, else public OSRM.
 */
export async function fetchDrivingDistanceKm(
  from: LatLng,
  to: LatLng,
): Promise<{ km: number; source: DrivingRouteSource } | null> {
  if (isMapboxDirectionsEnabled()) {
    const mapboxKm = await fetchMapboxDrivingDistanceKm(from, to);
    return mapboxKm != null ? { km: mapboxKm, source: "mapbox" } : null;
  }

  const osrmKm = await fetchOsrmDrivingDistanceKm(from, to);
  if (osrmKm != null) return { km: osrmKm, source: "osrm" };
  return null;
}

/**
 * Route polyline: Mapbox Directions when token is set, else OSRM.
 */
export async function fetchDrivingRoutePolyline(
  from: LatLng,
  to: LatLng,
): Promise<{ coordinates: LatLng[]; source: DrivingRouteSource } | null> {
  if (isMapboxDirectionsEnabled()) {
    const mapboxRoute = await fetchMapboxDrivingRoute(from, to);
    if (mapboxRoute && mapboxRoute.length >= 2) {
      return { coordinates: mapboxRoute, source: "mapbox" };
    }
  }

  const osrmRoute = await fetchOsrmDrivingRoute(from, to);
  if (osrmRoute && osrmRoute.length >= 2) {
    return { coordinates: osrmRoute, source: "osrm" };
  }
  return null;
}
