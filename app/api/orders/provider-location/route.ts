import { orderStatusSharesProviderLiveLocation } from "@/lib/constants/live-location";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getUserIdFromBearer } from "@/lib/supabase/route-user";

/** Latest provider GPS for an order (customer or assigned provider). */
export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient();
    const userId = await getUserIdFromBearer(supabase, req);
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const orderId = String(req.nextUrl.searchParams.get("order_id") || "").trim();
    if (!orderId) {
      return NextResponse.json(
        { ok: false, error: "MISSING_ORDER_ID" },
        { status: 400 },
      );
    }

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, customer_id, provider_id, status")
      .eq("id", orderId)
      .maybeSingle();

    if (orderErr || !order) {
      return NextResponse.json(
        { ok: false, error: "ORDER_NOT_FOUND" },
        { status: 404 },
      );
    }

    const customerId = String(order.customer_id || "");
    const providerId = String(order.provider_id || "");
    if (userId !== customerId && userId !== providerId) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const status = String(order.status || "");
    if (!orderStatusSharesProviderLiveLocation(status)) {
      return NextResponse.json({
        ok: true,
        inactive: true,
        current_status: status,
        location: null,
      });
    }

    if (!providerId) {
      return NextResponse.json({
        ok: true,
        location: null,
        source: "no_provider",
      });
    }

    const { data: live } = await supabase
      .from("provider_realtime_locations")
      .select("lat, lng, recorded_at")
      .eq("order_id", orderId)
      .eq("provider_id", providerId)
      .maybeSingle();

    const liveLat = Number(live?.lat);
    const liveLng = Number(live?.lng);
    if (Number.isFinite(liveLat) && Number.isFinite(liveLng)) {
      return NextResponse.json({
        ok: true,
        location: { lat: liveLat, lng: liveLng },
        recorded_at: live?.recorded_at ?? null,
        source: "realtime",
      });
    }

    const { data: details } = await supabase
      .from("provider_details")
      .select("lat, lng")
      .eq("id", providerId)
      .maybeSingle();

    const baseLat = Number(details?.lat);
    const baseLng = Number(details?.lng);
    if (Number.isFinite(baseLat) && Number.isFinite(baseLng)) {
      return NextResponse.json({
        ok: true,
        location: { lat: baseLat, lng: baseLng },
        source: "provider_details",
      });
    }

    return NextResponse.json({ ok: true, location: null, source: "none" });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "LOCATION_READ_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
