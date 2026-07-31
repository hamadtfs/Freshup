import type { SupabaseClient } from "@supabase/supabase-js";
import {
  authorizeAmountFromPriceLock,
  captureAmountFromPriceLock,
  type PriceLockPaymentSlice,
} from "@/lib/payments/payment-amounts";
import { maxDeliveryFeeAtDispatchRadius } from "@/lib/payments/delivery-ceiling";
import {
  resolveAddonsCustomerTotal,
  sumOrderAddonsCustomerTotal,
} from "@/lib/payments/order-addon-totals";
import { getStripe, isStripeConfigured, toStripeMinorUnits } from "@/lib/payments/stripe";
import { ensureStripeCustomer } from "@/lib/payments/stripe-customer";

const AUTHORIZED_PI_STATUSES = new Set([
  "requires_capture",
  "processing",
  "succeeded",
]);

type BookingLockRow = PriceLockPaymentSlice & {
  id: string;
  customer_id: string;
  expires_at?: string | null;
  consumed_at?: string | null;
  order_id?: string | null;
  stripe_payment_intent_id?: string | null;
  payment_authorized_amount?: number | null;
  payment_authorized_at?: string | null;
  payment_captured_amount?: number | null;
  payment_captured_at?: string | null;
  payment_status?: string | null;
  currency?: string | null;
};

async function loadCustomerLock(
  supabase: SupabaseClient,
  priceLockId: string,
  customerId: string,
): Promise<BookingLockRow | null> {
  const { data, error } = await supabase
    .from("booking_price_locks")
    .select("*")
    .eq("id", priceLockId)
    .eq("customer_id", customerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as BookingLockRow | null) ?? null;
}

function lockIsUsable(lock: BookingLockRow): boolean {
  if (lock.consumed_at) return false;
  const expiresAt = new Date(String(lock.expires_at || "")).getTime();
  if (Number.isFinite(expiresAt) && expiresAt < Date.now()) return false;
  return true;
}

export async function prepareBookingPayment(
  supabase: SupabaseClient,
  priceLockId: string,
  customerId: string,
): Promise<
  | { ok: true; clientSecret: string; authorizeAmountKr: number; deliveryCeilingKr: number }
  | { ok: false; error: string; status?: number }
> {
  if (!isStripeConfigured()) {
    return { ok: false, error: "STRIPE_NOT_CONFIGURED", status: 400 };
  }

  const lock = await loadCustomerLock(supabase, priceLockId, customerId);
  if (!lock) return { ok: false, error: "PRICE_LOCK_NOT_FOUND", status: 404 };
  if (!lockIsUsable(lock)) {
    return { ok: false, error: "PRICE_LOCK_EXPIRED", status: 410 };
  }

  const authorizeAmountKr = authorizeAmountFromPriceLock(lock);
  const deliveryCeilingKr =
    lock.delivery_mode === "home" ? maxDeliveryFeeAtDispatchRadius() : 0;

  const stripeCustomerId = await ensureStripeCustomer(supabase, customerId);
  const stripe = getStripe();
  let intentId = lock.stripe_payment_intent_id ?? null;
  let clientSecret: string | null = null;
  const amountMinor = toStripeMinorUnits(authorizeAmountKr);

  if (intentId) {
    const existing = await stripe.paymentIntents.retrieve(intentId);
    if (AUTHORIZED_PI_STATUSES.has(existing.status)) {
      return {
        ok: true,
        clientSecret: existing.client_secret!,
        authorizeAmountKr,
        deliveryCeilingKr,
      };
    }
    if (
      existing.status === "requires_payment_method" ||
      existing.status === "requires_confirmation"
    ) {
      const needsUpdate =
        existing.amount !== amountMinor ||
        (stripeCustomerId && existing.customer !== stripeCustomerId);
      const updated = needsUpdate
        ? await stripe.paymentIntents.update(intentId, {
            amount: amountMinor,
            ...(stripeCustomerId ? { customer: stripeCustomerId } : {}),
          })
        : existing;
      clientSecret = updated.client_secret;
    } else if (existing.status === "canceled") {
      intentId = null;
    } else {
      return { ok: false, error: `PI_STATUS_${existing.status}`, status: 409 };
    }
  }

  if (!intentId) {
    const created = await stripe.paymentIntents.create({
      amount: amountMinor,
      currency: (lock.currency || "nok").toLowerCase(),
      capture_method: "manual",
      payment_method_types: ["card"],
      ...(stripeCustomerId ? { customer: stripeCustomerId } : {}),
      metadata: {
        price_lock_id: priceLockId,
        customer_id: customerId,
      },
    });
    intentId = created.id;
    clientSecret = created.client_secret;
  }

  if (!clientSecret || !intentId) {
    return { ok: false, error: "PI_CREATE_FAILED", status: 500 };
  }

  await supabase
    .from("booking_price_locks")
    .update({
      stripe_payment_intent_id: intentId,
      payment_authorized_amount: authorizeAmountKr,
      payment_status: "requires_confirmation",
    })
    .eq("id", priceLockId)
    .eq("customer_id", customerId);

  return {
    ok: true,
    clientSecret,
    authorizeAmountKr,
    deliveryCeilingKr,
  };
}

/**
 * Confirm a prepared booking PaymentIntent with a saved card (server-side).
 * Used by mobile: if SCA/3DS is required, returns requires_action + client_secret
 * for the client WebView to finish with Stripe.js.
 */
export async function confirmBookingPayment(
  supabase: SupabaseClient,
  priceLockId: string,
  customerId: string,
  paymentMethodId: string,
): Promise<
  | { ok: true; requiresAction: false }
  | { ok: true; requiresAction: true; clientSecret: string }
  | { ok: false; error: string; status?: number }
> {
  if (!isStripeConfigured()) {
    return { ok: false, error: "STRIPE_NOT_CONFIGURED", status: 400 };
  }

  const pmId = String(paymentMethodId || "").trim();
  if (!pmId) {
    return { ok: false, error: "payment_method_id is required", status: 400 };
  }

  const lock = await loadCustomerLock(supabase, priceLockId, customerId);
  if (!lock) return { ok: false, error: "PRICE_LOCK_NOT_FOUND", status: 404 };
  if (!lockIsUsable(lock)) {
    return { ok: false, error: "PRICE_LOCK_EXPIRED", status: 410 };
  }
  if (!lock.stripe_payment_intent_id) {
    return { ok: false, error: "PAYMENT_NOT_PREPARED", status: 422 };
  }

  const { data: ownedPm } = await supabase
    .from("payment_methods")
    .select("id")
    .eq("customer_id", customerId)
    .eq("provider_payment_method_id", pmId)
    .maybeSingle();
  if (!ownedPm) {
    return { ok: false, error: "PAYMENT_METHOD_NOT_FOUND", status: 404 };
  }

  const stripe = getStripe();
  const intentId = lock.stripe_payment_intent_id;
  let pi = await stripe.paymentIntents.retrieve(intentId);

  if (AUTHORIZED_PI_STATUSES.has(pi.status)) {
    await supabase
      .from("booking_price_locks")
      .update({ payment_status: pi.status })
      .eq("id", priceLockId)
      .eq("customer_id", customerId);
    return { ok: true, requiresAction: false };
  }

  if (pi.status === "requires_action") {
    if (!pi.client_secret) {
      return { ok: false, error: "PI_MISSING_CLIENT_SECRET", status: 500 };
    }
    return {
      ok: true,
      requiresAction: true,
      clientSecret: pi.client_secret,
    };
  }

  if (
    pi.status !== "requires_payment_method" &&
    pi.status !== "requires_confirmation"
  ) {
    return { ok: false, error: `PI_STATUS_${pi.status}`, status: 409 };
  }

  try {
    pi = await stripe.paymentIntents.confirm(intentId, {
      payment_method: pmId,
      use_stripe_sdk: true,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "PAYMENT_CONFIRM_FAILED";
    return { ok: false, error: message, status: 402 };
  }

  await supabase
    .from("booking_price_locks")
    .update({ payment_status: pi.status })
    .eq("id", priceLockId)
    .eq("customer_id", customerId);

  if (AUTHORIZED_PI_STATUSES.has(pi.status)) {
    return { ok: true, requiresAction: false };
  }

  if (pi.status === "requires_action") {
    if (!pi.client_secret) {
      return { ok: false, error: "PI_MISSING_CLIENT_SECRET", status: 500 };
    }
    return {
      ok: true,
      requiresAction: true,
      clientSecret: pi.client_secret,
    };
  }

  return { ok: false, error: `PI_STATUS_${pi.status}`, status: 402 };
}

export async function markBookingPaymentAuthorized(
  supabase: SupabaseClient,
  priceLockId: string,
  customerId: string,
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  if (!isStripeConfigured()) {
    return { ok: false, error: "STRIPE_NOT_CONFIGURED", status: 400 };
  }

  const lock = await loadCustomerLock(supabase, priceLockId, customerId);
  if (!lock?.stripe_payment_intent_id) {
    return { ok: false, error: "PAYMENT_NOT_PREPARED", status: 422 };
  }

  const stripe = getStripe();
  const pi = await stripe.paymentIntents.retrieve(lock.stripe_payment_intent_id);
  if (!AUTHORIZED_PI_STATUSES.has(pi.status)) {
    return { ok: false, error: `PI_NOT_AUTHORIZED_${pi.status}`, status: 402 };
  }

  const authorizedKr = (pi.amount_capturable ?? pi.amount) / 100;
  await supabase
    .from("booking_price_locks")
    .update({
      payment_authorized_amount: authorizedKr,
      payment_authorized_at: new Date().toISOString(),
      payment_status: pi.status,
    })
    .eq("id", priceLockId)
    .eq("customer_id", customerId);

  return { ok: true };
}

export async function assertBookingPaymentAuthorized(
  supabase: SupabaseClient,
  priceLockId: string,
  customerId: string,
): Promise<void> {
  if (!isStripeConfigured()) return;

  const lock = await loadCustomerLock(supabase, priceLockId, customerId);
  if (!lock) throw new Error("PRICE_LOCK_NOT_FOUND");
  if (lock.payment_authorized_at && lock.stripe_payment_intent_id) return;

  const marked = await markBookingPaymentAuthorized(
    supabase,
    priceLockId,
    customerId,
  );
  if (!marked.ok) throw new Error(marked.error);
}

export async function captureOrderPaymentAtMatch(
  supabase: SupabaseClient,
  orderId: string,
  deliveryKm?: number | null,
): Promise<{ captured: boolean; amountKr: number | null; error?: string }> {
  if (!isStripeConfigured()) {
    return { captured: false, amountKr: null, error: "STRIPE_NOT_CONFIGURED" };
  }

  const { data: lock } = await supabase
    .from("booking_price_locks")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle();

  if (!lock?.stripe_payment_intent_id) {
    return { captured: false, amountKr: null, error: "NO_PAYMENT_INTENT" };
  }

  if (lock.payment_captured_at) {
    return {
      captured: true,
      amountKr: Number(lock.payment_captured_amount) || null,
    };
  }

  const { data: order } = await supabase
    .from("orders")
    .select("price, customer_id")
    .eq("id", orderId)
    .maybeSingle();

  const orderAddonsCustomerTotal = await sumOrderAddonsCustomerTotal(
    supabase,
    orderId,
  );
  const lockForCapture = {
    ...(lock as PriceLockPaymentSlice),
    addons_customer_total: resolveAddonsCustomerTotal(
      (lock as PriceLockPaymentSlice).addons_customer_total,
      orderAddonsCustomerTotal,
    ),
  };

  const exactKr = captureAmountFromPriceLock(
    lockForCapture,
    deliveryKm,
    Number(order?.price) || 0,
  );
  if (
    orderAddonsCustomerTotal > 0 &&
    !(Number((lock as PriceLockPaymentSlice).addons_customer_total) > 0)
  ) {
    await supabase
      .from("booking_price_locks")
      .update({ addons_customer_total: lockForCapture.addons_customer_total })
      .eq("order_id", orderId);
  }
  const authorizedKr = Number(lock.payment_authorized_amount) || 0;
  if (authorizedKr > 0 && exactKr > authorizedKr + 0.01) {
    return {
      captured: false,
      amountKr: exactKr,
      error: "CAPTURE_EXCEEDS_AUTHORIZED",
    };
  }

  const stripe = getStripe();
  const intentId = lock.stripe_payment_intent_id;
  try {
    const pi = await stripe.paymentIntents.capture(intentId, {
      amount_to_capture: toStripeMinorUnits(exactKr),
    });
    const capturedKr = (pi.amount_received ?? pi.amount_capturable ?? 0) / 100;
    const now = new Date().toISOString();

    await supabase
      .from("booking_price_locks")
      .update({
        payment_captured_amount: capturedKr || exactKr,
        payment_captured_at: now,
        payment_status: pi.status,
      })
      .eq("order_id", orderId);

    if (order?.customer_id) {
      const paymentRow = {
        order_id: orderId,
        customer_id: order.customer_id,
        amount: Math.round((capturedKr || exactKr) * 100),
        currency: (lock.currency || "NOK").toUpperCase(),
        status: pi.status === "succeeded" ? "succeeded" : pi.status,
        provider: "stripe",
        provider_intent_id: intentId,
        paid_at: pi.status === "succeeded" ? now : null,
        updated_at: now,
      };
      const { data: existingPayment } = await supabase
        .from("payments")
        .select("id")
        .eq("order_id", orderId)
        .maybeSingle();
      if (existingPayment?.id) {
        await supabase.from("payments").update(paymentRow).eq("id", existingPayment.id);
      } else {
        await supabase.from("payments").insert(paymentRow);
      }
    }

    return { captured: pi.status === "succeeded", amountKr: capturedKr || exactKr };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "CAPTURE_FAILED";
    return { captured: false, amountKr: exactKr, error: message };
  }
}

export async function releaseOrderPayment(
  supabase: SupabaseClient,
  orderId: string,
): Promise<void> {
  if (!isStripeConfigured()) return;

  const { data: lock } = await supabase
    .from("booking_price_locks")
    .select("stripe_payment_intent_id, payment_captured_at")
    .eq("order_id", orderId)
    .maybeSingle();

  const intentId = lock?.stripe_payment_intent_id;
  if (!intentId || lock?.payment_captured_at) return;

  const stripe = getStripe();
  try {
    const pi = await stripe.paymentIntents.retrieve(intentId);
    if (pi.status === "requires_capture" || pi.status === "requires_confirmation") {
      await stripe.paymentIntents.cancel(intentId);
    }
  } catch {
    // best-effort release
  }

  await supabase
    .from("booking_price_locks")
    .update({
      payment_status: "canceled",
    })
    .eq("order_id", orderId);
}

export async function releaseBookingPaymentByLock(
  supabase: SupabaseClient,
  priceLockId: string,
  customerId: string,
): Promise<void> {
  if (!isStripeConfigured()) return;

  const lock = await loadCustomerLock(supabase, priceLockId, customerId);
  if (!lock?.stripe_payment_intent_id || lock.payment_captured_at) return;

  const stripe = getStripe();
  try {
    const pi = await stripe.paymentIntents.retrieve(lock.stripe_payment_intent_id);
    if (
      pi.status === "requires_capture" ||
      pi.status === "requires_confirmation" ||
      pi.status === "requires_payment_method"
    ) {
      await stripe.paymentIntents.cancel(lock.stripe_payment_intent_id);
    }
  } catch {
    // ignore
  }

  await supabase
    .from("booking_price_locks")
    .update({
      payment_status: "canceled",
    })
    .eq("id", priceLockId);
}

/** @deprecated Use releaseOrderPayment — kept for cancel route import. */
export async function authorizeOrderPayment(
  supabase: SupabaseClient,
  orderId: string,
  customerId: string,
) {
  const { data: lock } = await supabase
    .from("booking_price_locks")
    .select("id")
    .eq("order_id", orderId)
    .eq("customer_id", customerId)
    .maybeSingle();
  if (!lock?.id) {
    return { ok: false, error: "NO_LOCK_FOR_ORDER" };
  }
  const result = await markBookingPaymentAuthorized(
    supabase,
    lock.id,
    customerId,
  );
  return { ok: result.ok, paymentIntentId: null, ...result };
}
