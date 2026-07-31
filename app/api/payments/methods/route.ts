import { createAdminClient } from "@/lib/supabase/server";
import { getUserIdFromBearer } from "@/lib/supabase/route-user";
import {
  confirmSetupIntent,
  listCustomerPaymentMethods,
  paymentMethodLabel,
} from "@/lib/payments/payment-methods";
import { isStripeConfigured } from "@/lib/payments/stripe";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    if (!isStripeConfigured()) {
      return NextResponse.json({ methods: [], stripe_configured: false });
    }

    const supabase = createAdminClient();
    const userId = await getUserIdFromBearer(supabase, req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rows = await listCustomerPaymentMethods(supabase, userId);
    return NextResponse.json({
      stripe_configured: true,
      methods: rows.map((m) => ({
        id: m.id,
        kind: m.kind,
        brand: m.brand,
        last4: m.last4,
        exp_month: m.exp_month,
        exp_year: m.exp_year,
        is_default: m.is_default,
        label: paymentMethodLabel(m),
        stripe_payment_method_id: m.provider_payment_method_id,
      })),
    });
  } catch (error) {
    console.error("[payments/methods GET]", error);
    return NextResponse.json(
      { error: "Failed to load payment methods" },
      { status: 500 },
    );
  }
}

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

    const body = (await req.json()) as { setup_intent_id?: string };
    const setupIntentId = String(body.setup_intent_id || "").trim();
    if (!setupIntentId) {
      return NextResponse.json(
        { error: "setup_intent_id is required" },
        { status: 400 },
      );
    }

    const row = await confirmSetupIntent(supabase, userId, setupIntentId);
    return NextResponse.json({
      ok: true,
      method: {
        id: row.id,
        brand: row.brand,
        last4: row.last4,
        is_default: row.is_default,
      },
    });
  } catch (error) {
    console.error("[payments/methods POST]", error);
    const message =
      error instanceof Error ? error.message : "CONFIRM_SETUP_FAILED";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
