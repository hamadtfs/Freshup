import { createAdminClient } from "@/lib/supabase/server";
import { getStripe, isStripeConfigured } from "@/lib/payments/stripe";
import { syncProviderFromStripeAccount } from "@/lib/payments/stripe-connect";
import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — Stripe Connect webhooks (account.updated). */
export async function POST(req: NextRequest) {
  try {
    if (!isStripeConfigured()) {
      return NextResponse.json(
        { error: "STRIPE_NOT_CONFIGURED" },
        { status: 503 },
      );
    }

    const secret = process.env.STRIPE_WEBHOOK_SECRET || "";
    const signature = req.headers.get("stripe-signature") || "";
    const rawBody = await req.text();

    const stripe = getStripe();
    let event: Stripe.Event;

    if (secret && signature) {
      try {
        event = stripe.webhooks.constructEvent(rawBody, signature, secret);
      } catch (err) {
        console.error("[stripe/webhooks] signature verify failed", err);
        return NextResponse.json({ error: "INVALID_SIGNATURE" }, { status: 400 });
      }
    } else if (process.env.NODE_ENV === "development") {
      // Local testing without signature (never in production).
      event = JSON.parse(rawBody) as Stripe.Event;
    } else {
      return NextResponse.json(
        { error: "STRIPE_WEBHOOK_SECRET required" },
        { status: 500 },
      );
    }

    if (event.type === "account.updated") {
      const account = event.data.object as Stripe.Account;
      const supabase = createAdminClient();
      await syncProviderFromStripeAccount(supabase, account);
    }

    return NextResponse.json({ received: true });
  } catch (e) {
    console.error("[stripe/webhooks]", e);
    return NextResponse.json({ error: "WEBHOOK_FAILED" }, { status: 500 });
  }
}
