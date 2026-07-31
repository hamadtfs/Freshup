import { createAdminClient } from "@/lib/supabase/server";
import { getUserIdFromBearer } from "@/lib/supabase/route-user";
import { resolveCustomerServicePrice } from "@/lib/pricing/home-order-total";
import { providerNetFromCustomerAmount } from "@/lib/pricing/provider-offer";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient();
    const userId = await getUserIdFromBearer(supabase, req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const orderId = String(req.nextUrl.searchParams.get("order_id") || "").trim();
    if (!orderId) {
      return NextResponse.json(
        { error: "order_id is required" },
        { status: 400 },
      );
    }

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, provider_id, price, delivery_mode")
      .eq("id", orderId)
      .maybeSingle();
    if (orderErr) throw orderErr;
    if (!order?.id) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const isAssignedProvider =
      order.provider_id != null && String(order.provider_id) === userId;

    const { data: offer } = await supabase
      .from("order_offers")
      .select("id")
      .eq("order_id", orderId)
      .eq("provider_id", userId)
      .in("status", ["pending", "accepted"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!isAssignedProvider && !offer?.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [{ data: priceLock }, { data: orderAddonRows }] = await Promise.all([
      supabase
        .from("booking_price_locks")
        .select(
          "customer_service_price, provider_service_price, delivery_fee, addons_customer_total, addons_provider_total, customer_total, delivery_km",
        )
        .eq("order_id", orderId)
        .maybeSingle(),
      supabase
        .from("order_addons")
        .select("addon_id, unit_price, quantity, service_addons(name)")
        .eq("order_id", orderId),
    ]);

    const orderPrice = Number(order.price) || 0;
    const customerServicePrice = resolveCustomerServicePrice(
      priceLock,
      orderPrice,
    );
    const addonLines = (orderAddonRows ?? [])
      .map((row: any) => {
        const qty = Math.max(1, Number(row.quantity) || 1);
        const unit = Math.round(Number(row.unit_price) || 0);
        const name = String(row.service_addons?.name || "").trim();
        return {
          id: String(row.addon_id || name || unit),
          name: name || "Add-on",
          price: providerNetFromCustomerAmount(unit * qty),
        };
      })
      .filter((line) => line.name && line.price > 0);

    return NextResponse.json({
      price_lock: priceLock,
      customer_service_price: customerServicePrice,
      order_price: orderPrice,
      delivery_mode: order.delivery_mode,
      addon_lines: addonLines,
    });
  } catch (error) {
    console.error("[offer_pricing] error:", error);
    return NextResponse.json(
      { error: "Failed to fetch offer pricing" },
      { status: 500 },
    );
  }
}
