import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import Stripe from "stripe"

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { order_id: string; amount: number; currency?: string }
    const { order_id, amount, currency = "nok" } = body

    if (!order_id || !amount) {
      return NextResponse.json({ error: "MISSING_PARAMS" }, { status: 400 })
    }

    const secret = process.env.STRIPE_SECRET_KEY
    if (!secret) {
      return NextResponse.json({ error: "STRIPE_NOT_CONFIGURED" }, { status: 400 })
    }

    const stripe = new Stripe(secret, { apiVersion: "2024-06-20" })

    const supabase = createAdminClient()
    // See if we already created one for this order
    const { data: existing } = await supabase.from("payments").select("*").eq("order_id", order_id).maybeSingle()

    let paymentIntentId: string | null = existing?.stripe_payment_intent_id ?? null
    let pi

    const amountInMinor = Math.max(100, Math.round(amount * 100)) // NOK øre

    if (paymentIntentId) {
      pi = await stripe.paymentIntents.retrieve(paymentIntentId)
      if (pi.status === "requires_payment_method" || pi.status === "requires_confirmation") {
        // Update amount if changed
        if (pi.amount !== amountInMinor) {
          pi = await stripe.paymentIntents.update(paymentIntentId, { amount: amountInMinor })
        }
      }
    } else {
      pi = await stripe.paymentIntents.create({
        amount: amountInMinor,
        currency,
        // Manual capture to authorize now and capture on completion
        capture_method: "manual",
        payment_method_types: ["card"],
        metadata: { order_id },
      })
      paymentIntentId = pi.id
      if (existing) {
        await supabase
          .from("payments")
          .update({ stripe_payment_intent_id: paymentIntentId, status: pi.status, amount: amount })
          .eq("order_id", order_id)
      } else {
        await supabase.from("payments").insert({
          order_id,
          stripe_payment_intent_id: paymentIntentId,
          status: pi.status,
          amount: amount,
          provider_payout: null,
          fee: null,
        })
      }
    }

    return NextResponse.json({ client_secret: pi.client_secret })
  } catch (e) {
    return NextResponse.json({ error: "CREATE_INTENT_ERROR" }, { status: 500 })
  }
}
