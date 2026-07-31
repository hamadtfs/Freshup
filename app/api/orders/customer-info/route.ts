import { createAdminClient } from "@/lib/supabase/server";
import { getUserIdFromBearer } from "@/lib/supabase/route-user";
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
      .select("id, customer_id, provider_id")
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

    const customerId = String(order.customer_id || "");
    if (!customerId) {
      return NextResponse.json(
        { error: "Order has no customer" },
        { status: 404 },
      );
    }

    const [{ data: profile }, { data: details }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, display_name, avatar_url, phone")
        .eq("id", customerId)
        .maybeSingle(),
      supabase
        .from("customer_details")
        .select("phone")
        .eq("id", customerId)
        .maybeSingle(),
    ]);

    const displayName = String(
      (profile as { display_name?: string } | null)?.display_name || "",
    ).trim();
    const avatarUrl = String(
      (profile as { avatar_url?: string } | null)?.avatar_url || "",
    ).trim();
    const phone =
      String((profile as { phone?: string } | null)?.phone || "").trim() ||
      String((details as { phone?: string } | null)?.phone || "").trim() ||
      null;

    return NextResponse.json({
      customer: {
        id: customerId,
        name: displayName || `Customer ${customerId.slice(0, 6)}`,
        avatarUrl: avatarUrl || null,
        phone,
      },
    });
  } catch (error) {
    console.error("[order_customer_info] error:", error);
    return NextResponse.json(
      { error: "Failed to fetch customer info" },
      { status: 500 },
    );
  }
}
