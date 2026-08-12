import { createAdminClient } from "@/lib/supabase/server";
import { getUserIdFromBearer } from "@/lib/supabase/route-user";
import { releaseOrderPayment } from "@/lib/payments/order-payment";
import { refreshDemandZoneAt } from "@/lib/pricing/used-capacity";
import { NextRequest, NextResponse } from "next/server";

/**
 * Customer abandons the “waiting for a provider” window.
 * Cancels the order (still unassigned) and expires pending offers so rows do not stay `offered`.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient();
    const userId = await getUserIdFromBearer(supabase, req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as { order_id?: string };
    const orderId = String(body.order_id || "").trim();
    if (!orderId) {
      return NextResponse.json({ error: "order_id is required" }, { status: 400 });
    }

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select(
        "id, customer_id, provider_id, status, service_id, customer_lat, customer_lng",
      )
      .eq("id", orderId)
      .maybeSingle();
    if (orderErr) throw orderErr;
    if (!order || String(order.customer_id) !== userId) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (order.provider_id) {
      return NextResponse.json({ ok: true, outcome: "already_assigned" });
    }

    if (order.status !== "offered" && order.status !== "pending") {
      return NextResponse.json({
        ok: true,
        outcome: "no_action",
        status: order.status,
      });
    }

    const now = new Date().toISOString();

    const { data: updatedRows, error: updErr } = await supabase
      .from("orders")
      .update({
        status: "cancelled",
        cancelled_at: now,
        cancellation_reason: "customer_abandoned_search",
      })
      .eq("id", orderId)
      .is("provider_id", null)
      .in("status", ["offered", "pending"])
      .select("id");

    if (updErr) throw updErr;
    if (!updatedRows?.length) {
      return NextResponse.json({ ok: true, outcome: "already_final" });
    }

    await supabase
      .from("order_offers")
      .update({ status: "expired", responded_at: now })
      .eq("order_id", orderId)
      .eq("status", "pending");

    await supabase.from("order_events").insert({
      order_id: orderId,
      event_type: "customer_aborted_search",
      actor_id: userId,
      metadata: {},
    });

    await releaseOrderPayment(supabase, orderId);

    const serviceId = String(order.service_id || "").trim();
    const lat = Number(order.customer_lat);
    const lng = Number(order.customer_lng);
    if (serviceId && Number.isFinite(lat) && Number.isFinite(lng)) {
      void refreshDemandZoneAt(supabase, serviceId, lat, lng).catch((err) =>
        console.error("[abort-search] demand zone refresh:", err),
      );
    }

    return NextResponse.json({ ok: true, outcome: "aborted" });
  } catch (error) {
    console.error("[abort-search] error:", error);
    return NextResponse.json(
      { error: "Failed to abort search" },
      { status: 500 },
    );
  }
}
