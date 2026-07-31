import { createAdminClient } from "@/lib/supabase/server";
import { getUserIdFromBearer } from "@/lib/supabase/route-user";
import {
  removePaymentMethod,
  setDefaultPaymentMethod,
} from "@/lib/payments/payment-methods";
import { isStripeConfigured } from "@/lib/payments/stripe";
import { NextRequest, NextResponse } from "next/server";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    if (!isStripeConfigured()) {
      return NextResponse.json({ error: "STRIPE_NOT_CONFIGURED" }, { status: 400 });
    }

    const { id } = await context.params;
    const supabase = createAdminClient();
    const userId = await getUserIdFromBearer(supabase, req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as { is_default?: boolean };
    if (!body.is_default) {
      return NextResponse.json({ error: "Only is_default supported" }, { status: 400 });
    }

    await setDefaultPaymentMethod(supabase, userId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[payments/methods PATCH]", error);
    const message =
      error instanceof Error ? error.message : "UPDATE_PAYMENT_METHOD_FAILED";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    if (!isStripeConfigured()) {
      return NextResponse.json({ error: "STRIPE_NOT_CONFIGURED" }, { status: 400 });
    }

    const { id } = await context.params;
    const supabase = createAdminClient();
    const userId = await getUserIdFromBearer(supabase, req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await removePaymentMethod(supabase, userId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[payments/methods DELETE]", error);
    const message =
      error instanceof Error ? error.message : "DELETE_PAYMENT_METHOD_FAILED";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
