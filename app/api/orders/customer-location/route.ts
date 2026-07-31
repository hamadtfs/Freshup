import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      order_id?: string;
      customer_id?: string;
      lat?: number;
      lng?: number;
      accuracy_m?: number;
    };

    const orderId = String(body.order_id || "").trim();
    const customerId = String(body.customer_id || "").trim();
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const accuracyM = Number(body.accuracy_m);

    if (!orderId || !customerId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json(
        { ok: false, error: "MISSING_FIELDS" },
        { status: 400 },
      );
    }

    const supabase = createAdminClient();
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, customer_id, status")
      .eq("id", orderId)
      .maybeSingle();

    if (orderErr || !order) {
      return NextResponse.json(
        { ok: false, error: "ORDER_NOT_FOUND" },
        { status: 404 },
      );
    }

    if (String(order.customer_id || "") !== customerId) {
      return NextResponse.json(
        { ok: false, error: "NOT_ORDER_CUSTOMER" },
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
    if (!["assigned", "en_route", "arrived", "in_progress"].includes(status)) {
      return NextResponse.json(
        { ok: false,
          error: "ORDER_NOT_ACTIVE",
          current_status: status,
        },
        { status: 409 },
      );
    }

    const nowIso = new Date().toISOString();
    const { error: upsertErr } = await supabase
      .from("customer_realtime_locations")
      .upsert(
        {
          order_id: orderId,
          customer_id: customerId,
          lat,
          lng,
          accuracy_m: Number.isFinite(accuracyM) ? accuracyM : null,
          recorded_at: nowIso,
          updated_at: nowIso,
        },
        { onConflict: "customer_id,order_id" },
      );

    if (upsertErr) {
      return NextResponse.json(
        { ok: false, error: "LOCATION_UPDATE_FAILED", message: upsertErr.message },
        { status: 500 },
      );
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
