import { recordProviderEarningForOrder } from "@/lib/payments/provider-payout";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import Stripe from "stripe";

export async function POST(req: Request) {
  try {
    const { order_id, price_final, provider_id } = (await req.json()) as {
      order_id: string;
      price_final: number;
      provider_id?: string;
    };
    const supabase = createAdminClient();

    const orderId = String(order_id || "").trim();
    if (!orderId) {
      return NextResponse.json(
        { ok: false, error: "ORDER_ID_REQUIRED" },
        { status: 400 },
      );
    }

    // Ensure only the assigned provider can complete this order.
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, provider_id, status")
      .eq("id", orderId)
      .maybeSingle();
    if (orderErr || !order) {
      return NextResponse.json({ ok: false, error: "ORDER_NOT_FOUND" }, { status: 404 });
    }

    const providerId = String(provider_id || "").trim();
    if (!providerId || String(order.provider_id || "") !== providerId) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const currentStatus = String(order.status || "");
    if (currentStatus === "completed") {
      return NextResponse.json({
        ok: true,
        captured: true,
        idempotent: true,
      });
    }

    if (currentStatus !== "in_progress") {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_FROM_STATUS",
          current_status: currentStatus,
        },
        { status: 400 },
      );
    }

    // Update order status
    const { error: updErr } = await supabase
      .from("orders")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        ready_for_next_request_at: null,
        ready_for_next_at: null,
      })
      .eq("id", orderId)
      .eq("provider_id", providerId)
      .eq("status", "in_progress");
    if (updErr)
      return NextResponse.json(
        {
          ok: false,
          error: "UPDATE_FAILED",
          detail: updErr.message,
          code: updErr.code,
        },
        { status: 500 },
      );

    // Try to capture Stripe PI if present
    const { data: payment } = await supabase
      .from("payments")
      .select("*")
      .eq("order_id", orderId)
      .maybeSingle();

    let captured = false
    let captureError: string | null = null

    if (payment?.stripe_payment_intent_id && process.env.STRIPE_SECRET_KEY) {
      try {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
          apiVersion: "2026-03-25.dahlia",
        });
        const amountToCapture = Math.max(100, Math.round(price_final * 100));
        const pi = await stripe.paymentIntents.capture(payment.stripe_payment_intent_id, {
          amount_to_capture: amountToCapture,
        })
        captured = pi.status === "succeeded"
        // Update payments row
        await supabase
          .from("payments")
          .update({
            status: pi.status,
            amount: Math.round(pi.amount_capturable ? pi.amount_capturable / 100 : price_final),
            provider_payout: Math.round(price_final * 0.7),
            fee: price_final - Math.round(price_final * 0.7),
          })
          .eq("order_id", orderId)
      } catch (e: any) {
        captureError = e?.message || "CAPTURE_FAILED"
        await supabase
          .from("payments")
          .update({
            status: "capture_failed",
            amount: price_final,
            provider_payout: Math.round(price_final * 0.7),
            fee: price_final - Math.round(price_final * 0.7),
          })
          .eq("order_id", orderId)
      }
    } else {
      // No Stripe configured: stub a captured payment row
      await supabase.from("payments").upsert({
        order_id: orderId,
        status: "captured",
        amount: price_final,
        provider_payout: Math.round(price_final * 0.7),
        fee: price_final - Math.round(price_final * 0.7),
      })
      captured = true
    }

    try {
      await supabase.from("order_events").insert({
        order_id: orderId,
        event_type: "provider_transition_completed",
        actor_id: providerId,
        metadata: { from_status: currentStatus, to_status: "completed" },
      });
    } catch {
      // audit-only
    }

    try {
      await recordProviderEarningForOrder(supabase, providerId, orderId);
    } catch {
      // wallet ledger is best-effort
    }

    return NextResponse.json({ ok: true, captured, error: captureError });
  } catch {
    return NextResponse.json(
      { ok: false, error: "COMPLETE_ERROR" },
      { status: 500 },
    );
  }
}
