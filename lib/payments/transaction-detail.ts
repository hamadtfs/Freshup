import type Stripe from "stripe";
import { getStripe, isStripeConfigured } from "@/lib/payments/stripe";

export function paymentMethodLabelFromStripe(
  pm: Stripe.PaymentMethod | null | undefined,
): string | null {
  if (!pm) return null;
  if (pm.type === "card" && pm.card) {
    const brand = String(pm.card.brand || "card").replace(/^\w/, (c) =>
      c.toUpperCase(),
    );
    const last4 = pm.card.last4 ? ` •••• ${pm.card.last4}` : "";
    return `${brand}${last4}`;
  }
  if (pm.type === "apple_pay") {
    return "Apple Pay";
  }
  return pm.type ? pm.type.replace(/_/g, " ") : null;
}

export async function resolveTransactionPaymentMethod(
  stripePaymentIntentId: string | null | undefined,
): Promise<string | null> {
  const intentId = String(stripePaymentIntentId || "").trim();
  if (!intentId || !isStripeConfigured()) return null;

  try {
    const stripe = getStripe();
    const pi = await stripe.paymentIntents.retrieve(intentId, {
      expand: ["payment_method", "latest_charge"],
    });
    const fromPm = paymentMethodLabelFromStripe(
      typeof pi.payment_method === "object" ? pi.payment_method : null,
    );
    if (fromPm) return fromPm;

    const charge =
      typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    const details = charge?.payment_method_details;
    if (details?.card) {
      const brand = String(details.card.brand || "card").replace(/^\w/, (c) =>
        c.toUpperCase(),
      );
      const last4 = details.card.last4 ? ` •••• ${details.card.last4}` : "";
      return `${brand}${last4}`;
    }
    if (details?.type === "apple_pay") return "Apple Pay";
    return null;
  } catch {
    return null;
  }
}

export async function resolveTransactionReceiptUrl(
  stripePaymentIntentId: string | null | undefined,
): Promise<string | null> {
  const intentId = String(stripePaymentIntentId || "").trim();
  if (!intentId || !isStripeConfigured()) return null;

  try {
    const stripe = getStripe();
    const pi = await stripe.paymentIntents.retrieve(intentId, {
      expand: ["latest_charge"],
    });
    const charge =
      typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    const url = String(charge?.receipt_url || "").trim();
    return url || null;
  } catch {
    return null;
  }
}
