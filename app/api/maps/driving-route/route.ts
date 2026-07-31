import { fetchDrivingRoutePolyline } from "@/lib/maps/driving-route";
import { isMapboxDirectionsEnabled } from "@/lib/maps/mapbox-config";
import { NextRequest, NextResponse } from "next/server";

function parseCoord(v: string | null): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const fromLat = parseCoord(params.get("from_lat"));
    const fromLng = parseCoord(params.get("from_lng"));
    const toLat = parseCoord(params.get("to_lat"));
    const toLng = parseCoord(params.get("to_lng"));

    if (
      fromLat == null ||
      fromLng == null ||
      toLat == null ||
      toLng == null
    ) {
      return NextResponse.json(
        { error: "from_lat, from_lng, to_lat, to_lng required" },
        { status: 400 },
      );
    }

    const from = { lat: fromLat, lng: fromLng };
    const to = { lat: toLat, lng: toLng };
    const result = await fetchDrivingRoutePolyline(from, to);

    if (!result) {
      return NextResponse.json(
        {
          error: "ROUTE_NOT_FOUND",
          mapbox_configured: isMapboxDirectionsEnabled(),
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      coordinates: result.coordinates,
      source: result.source,
      mapbox_configured: isMapboxDirectionsEnabled(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[maps/driving-route]", msg);
    return NextResponse.json(
      { error: "DRIVING_ROUTE_FAILED", message: msg },
      { status: 500 },
    );
  }
}
