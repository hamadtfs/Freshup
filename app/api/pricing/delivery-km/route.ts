import { createAdminClient } from "@/lib/supabase/server";
import { estimateHomeDeliveryDrivingKm } from "@/lib/pricing/home-delivery-km";
import { computeDeliveryFee } from "@/lib/pricing";
import { NextRequest, NextResponse } from "next/server";

function parseCoord(v: string | null): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const lat = parseCoord(params.get("lat"));
    const lng = parseCoord(params.get("lng"));
    if (lat == null || lng == null) {
      return NextResponse.json(
        { error: "lat and lng required" },
        { status: 400 },
      );
    }

    const serviceId = String(params.get("service_id") || "").trim() || null;
    const supabase = createAdminClient();
    const { delivery_km, source } = await estimateHomeDeliveryDrivingKm(
      supabase,
      { lat, lng },
      serviceId,
    );
    const delivery_fee = computeDeliveryFee(delivery_km, true);

    return NextResponse.json({
      delivery_km,
      delivery_fee,
      source,
      formula: "150 + (km × 10)",
      note:
        source === "mapbox_nearest_provider"
          ? "Mapbox driving km to nearest online provider."
          : source === "mapbox_area_center"
            ? "Mapbox driving km to area centre."
            : source === "osrm_nearest_provider"
              ? "OSRM driving km to nearest online provider."
              : source === "osrm_area_center"
                ? "OSRM driving km to area centre."
                : "Straight-line fallback (routing unavailable).",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[pricing/delivery-km]", msg);
    return NextResponse.json(
      { error: "DELIVERY_KM_FAILED", message: msg },
      { status: 500 },
    );
  }
}
