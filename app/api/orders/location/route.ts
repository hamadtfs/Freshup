import { orderStatusSharesProviderLiveLocation } from "@/lib/constants/live-location";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      order_id?: string;
      provider_id?: string;
      lat?: number;
      lng?: number;
      accuracy_m?: number;
    };

    const orderId = String(body.order_id || "").trim();
    const providerId = String(body.provider_id || "").trim();
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const accuracyM = Number(body.accuracy_m);

    if (!orderId || !providerId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json(
        { ok: false, error: "MISSING_FIELDS" },
        { status: 400 },
      );
    }

    const supabase = createAdminClient();
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, provider_id, status")
      .eq("id", orderId)
      .maybeSingle();

    if (orderErr || !order) {
      return NextResponse.json(
        { ok: false, error: "ORDER_NOT_FOUND" },
        { status: 404 },
      );
    }

    if (String(order.provider_id || "") !== providerId) {
      return NextResponse.json(
        { ok: false, error: "NOT_ASSIGNED_PROVIDER" },
        { status: 403 },
      );
    }

    const status = String(order.status || "");
    if (["completed", "cancelled"].includes(status)) {
      return NextResponse.json({
        ok: true,
        inactive: true,
        current_status: status,
      });
    }

    if (!orderStatusSharesProviderLiveLocation(status)) {
      return NextResponse.json({
        ok: true,
        inactive: true,
        current_status: status,
      });
    }

    const nowIso = new Date().toISOString();
    const locationPayload = {
      order_id: orderId,
      provider_id: providerId,
      lat,
      lng,
      accuracy_m: Number.isFinite(accuracyM) ? accuracyM : null,
      recorded_at: nowIso,
    };

    const { data: updatedRows, error: updateErr } = await supabase
      .from("provider_realtime_locations")
      .update(locationPayload)
      .eq("order_id", orderId)
      .eq("provider_id", providerId)
      .select("id");

    if (updateErr) {
      return NextResponse.json(
        { ok: false, error: "LOCATION_UPDATE_FAILED", message: updateErr.message },
        { status: 500 },
      );
    }

    if (!updatedRows || updatedRows.length === 0) {
      const { error: insertErr } = await supabase
        .from("provider_realtime_locations")
        .insert(locationPayload);

      if (insertErr) {
        return NextResponse.json(
          { ok: false, error: "LOCATION_UPDATE_FAILED", message: insertErr.message },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ ok: true, order_id: orderId });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "LOCATION_UPDATE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
