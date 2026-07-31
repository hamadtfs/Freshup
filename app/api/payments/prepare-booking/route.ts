import { createAdminClient } from "@/lib/supabase/server";
import { getUserIdFromBearer } from "@/lib/supabase/route-user";
import { prepareBookingPayment } from "@/lib/payments/order-payment";
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

    const result = await prepareBookingPayment(supabase, priceLockId, userId);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status ?? 400 },
      );
    }

    return NextResponse.json({
      client_secret: result.clientSecret,
      authorize_amount_kr: result.authorizeAmountKr,
      delivery_ceiling_kr: result.deliveryCeilingKr,
    });
  } catch (error) {
    console.error("[payments/prepare-booking]", error);
    return NextResponse.json(
      { error: "PREPARE_BOOKING_PAYMENT_FAILED" },
      { status: 500 },
    );
  }
}
