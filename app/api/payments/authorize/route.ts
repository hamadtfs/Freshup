import { createAdminClient } from "@/lib/supabase/server";
import { getUserIdFromBearer } from "@/lib/supabase/route-user";
import { markBookingPaymentAuthorized } from "@/lib/payments/order-payment";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient();
    const userId = await getUserIdFromBearer(supabase, req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as { price_lock_id?: string };
    const priceLockId = String(body.price_lock_id || "").trim();
    if (!priceLockId) {
      return NextResponse.json(
        { error: "price_lock_id is required" },
        { status: 400 },
      );
    }

    const result = await markBookingPaymentAuthorized(
      supabase,
      priceLockId,
      userId,
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status ?? 402 },
      );
    }

    const { data: lock } = await supabase
      .from("booking_price_locks")
      .select("payment_authorized_amount, stripe_payment_intent_id")
      .eq("id", priceLockId)
      .eq("customer_id", userId)
      .maybeSingle();

    return NextResponse.json({
      ok: true,
      payment_intent_id: lock?.stripe_payment_intent_id ?? null,
      authorized_amount_kr: lock?.payment_authorized_amount ?? null,
    });
  } catch (error) {
    console.error("[payments/authorize]", error);
    return NextResponse.json({ error: "AUTHORIZE_FAILED" }, { status: 500 });
  }
}
