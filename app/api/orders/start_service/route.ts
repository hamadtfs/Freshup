import { createAdminClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/** Move job to in_progress when the provider starts the service on-site (M4: after arrived, or earlier from assigned / en_route). */
export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient();
    const { order_id, provider_id } = (await req.json()) as {
      order_id?: string;
      provider_id?: string;
    };

    const orderId = String(order_id || "").trim();
    const providerId = String(provider_id || "").trim();
    if (!orderId || !providerId) {
      return NextResponse.json(
        { ok: false, error: "MISSING_FIELDS" },
        { status: 400 },
      );
    }

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
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const st = String(order.status || "");
    if (!["assigned", "en_route", "arrived"].includes(st)) {
      return NextResponse.json(
        { ok: false, error: "INVALID_STATUS", status: st },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const { error: updErr } = await supabase
      .from("orders")
      .update({
        status: "in_progress",
        started_at: now,
        ready_for_next_request_at: null,
        ready_for_next_at: null,
      })
      .eq("id", orderId)
      .eq("provider_id", providerId)
      .in("status", ["assigned", "en_route", "arrived"]);

    if (updErr) {
      return NextResponse.json(
        { ok: false, error: "UPDATE_FAILED", detail: updErr.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, started_at: now });
  } catch (e) {
    console.error("[start_service]", e);
    return NextResponse.json(
      { ok: false, error: "START_SERVICE_ERROR" },
      { status: 500 },
    );
  }
}
