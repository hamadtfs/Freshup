import { createAdminClient } from "@/lib/supabase/server";
import { getUserIdFromBearer } from "@/lib/supabase/route-user";
import { confirmBookingPayment } from "@/lib/payments/order-payment";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient();
    const userId = await getUserIdFromBearer(supabase, req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as {
      price_lock_id?: string;
      payment_method_id?: string;
    };
    const priceLockId = String(body.price_lock_id || "").trim();
    const paymentMethodId = String(body.payment_method_id || "").trim();

    if (!priceLockId) {
      return NextResponse.json(
        { error: "price_lock_id is required" },
        { status: 400 },
      );
    }
    if (!paymentMethodId) {
      return NextResponse.json(
        { error: "payment_method_id is required" },
        { status: 400 },
      );
    }

    const result = await confirmBookingPayment(
      supabase,
      priceLockId,
      userId,
      paymentMethodId,
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status ?? 400 },
      );
    }

    if (result.requiresAction) {
      return NextResponse.json({
        requires_action: true,
        client_secret: result.clientSecret,
      });
    }

    return NextResponse.json({ requires_action: false });
  } catch (error) {
    console.error("[payments/confirm-booking]", error);
    return NextResponse.json(
      { error: "CONFIRM_BOOKING_PAYMENT_FAILED" },
      { status: 500 },
    );
  }
}
