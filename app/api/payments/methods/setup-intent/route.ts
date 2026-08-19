import { createAdminClient } from "@/lib/supabase/server";
import { getUserIdFromBearer } from "@/lib/supabase/route-user";
import { createSetupIntent } from "@/lib/payments/payment-methods";
import { isStripeConfigured } from "@/lib/payments/stripe";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    if (!isStripeConfigured()) {
      return NextResponse.json({ error: "STRIPE_NOT_CONFIGURED" }, { status: 400 });
    }

    const supabase = createAdminClient();
    const userId = await getUserIdFromBearer(supabase, req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { clientSecret, setupIntentId } = await createSetupIntent(supabase, userId);
    return NextResponse.json({
      client_secret: clientSecret,
      setup_intent_id: setupIntentId,
    });
  } catch (error) {
    console.error("[payments/methods/setup-intent]", error);
    const message =
      error instanceof Error ? error.message : "SETUP_INTENT_FAILED";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
