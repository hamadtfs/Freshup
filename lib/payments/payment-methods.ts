import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { getStripe } from "@/lib/payments/stripe";
import { ensureStripeCustomer } from "@/lib/payments/stripe-customer";

export type PaymentMethodRow = {
  id: string;
  kind: string;
  brand: string | null;
  last4: string | null;
  exp_month: number | null;
  exp_year: number | null;
  is_default: boolean;
  provider_payment_method_id: string | null;
};

function formatBrand(brand: string | null | undefined): string {
  const b = String(brand || "card").toLowerCase();
  if (b === "amex") return "American Express";
  if (b === "mastercard") return "Mastercard";
  if (b === "visa") return "Visa";
  return b.charAt(0).toUpperCase() + b.slice(1);
}

export function paymentMethodLabel(row: PaymentMethodRow): string {
  return `${formatBrand(row.brand)} •••• ${row.last4 || "????"}`;
}

async function upsertCardFromStripe(
  supabase: SupabaseClient,
  userId: string,
  pm: Stripe.PaymentMethod,
  isDefault: boolean,
): Promise<PaymentMethodRow> {
  const card = pm.card;
  const providerPmId = pm.id;

  const { data: existing } = await supabase
    .from("payment_methods")
    .select("id")
    .eq("customer_id", userId)
    .eq("provider_payment_method_id", providerPmId)
    .maybeSingle();

  const payload = {
    customer_id: userId,
    kind: "card",
    provider: "stripe",
    provider_payment_method_id: providerPmId,
    brand: card?.brand ?? null,
    last4: card?.last4 ?? null,
    exp_month: card?.exp_month ?? null,
    exp_year: card?.exp_year ?? null,
    is_default: isDefault,
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const { data, error } = await supabase
      .from("payment_methods")
      .update(payload)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data as PaymentMethodRow;
  }

  const { data, error } = await supabase
    .from("payment_methods")
    .insert(payload)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as PaymentMethodRow;
}

export async function listCustomerPaymentMethods(
  supabase: SupabaseClient,
  userId: string,
): Promise<PaymentMethodRow[]> {
  const { data, error } = await supabase
    .from("payment_methods")
    .select(
      "id, kind, brand, last4, exp_month, exp_year, is_default, provider_payment_method_id",
    )
    .eq("customer_id", userId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as PaymentMethodRow[];
}

export async function createSetupIntent(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ clientSecret: string; setupIntentId: string }> {
  const stripeCustomerId = await ensureStripeCustomer(supabase, userId);
  if (!stripeCustomerId) {
    throw new Error("STRIPE_NOT_CONFIGURED");
  }

  const stripe = getStripe();
  const intent = await stripe.setupIntents.create({
    customer: stripeCustomerId,
    payment_method_types: ["card"],
    usage: "off_session",
    metadata: { supabase_user_id: userId },
  });
  if (!intent.client_secret) {
    throw new Error("SETUP_INTENT_NO_SECRET");
  }
  return { clientSecret: intent.client_secret, setupIntentId: intent.id };
}

export async function confirmSetupIntent(
  supabase: SupabaseClient,
  userId: string,
  setupIntentId: string,
): Promise<PaymentMethodRow> {
  const stripeCustomerId = await ensureStripeCustomer(supabase, userId);
  if (!stripeCustomerId) {
    throw new Error("STRIPE_NOT_CONFIGURED");
  }

  const stripe = getStripe();
  const intent = await stripe.setupIntents.retrieve(setupIntentId);
  if (intent.metadata?.supabase_user_id !== userId) {
    throw new Error("SETUP_INTENT_FORBIDDEN");
  }
  if (intent.status !== "succeeded") {
    throw new Error(`SETUP_INTENT_${intent.status}`);
  }

  const pmId =
    typeof intent.payment_method === "string"
      ? intent.payment_method
      : intent.payment_method?.id;
  if (!pmId) throw new Error("SETUP_INTENT_NO_PAYMENT_METHOD");

  const pm = await stripe.paymentMethods.retrieve(pmId);
  if (pm.customer !== stripeCustomerId) {
    await stripe.paymentMethods.attach(pmId, { customer: stripeCustomerId });
  }

  const existing = await listCustomerPaymentMethods(supabase, userId);
  const isFirst = existing.length === 0;

  const row = await upsertCardFromStripe(supabase, userId, pm, isFirst);
  if (isFirst) {
    await stripe.customers.update(stripeCustomerId, {
      invoice_settings: { default_payment_method: pmId },
    });
  }

  return row;
}

export async function setDefaultPaymentMethod(
  supabase: SupabaseClient,
  userId: string,
  methodId: string,
): Promise<void> {
  const { data: row, error } = await supabase
    .from("payment_methods")
    .select("id, provider_payment_method_id")
    .eq("id", methodId)
    .eq("customer_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error("PAYMENT_METHOD_NOT_FOUND");

  const pmId = String(row.provider_payment_method_id || "").trim();
  if (!pmId) throw new Error("PAYMENT_METHOD_INVALID");

  const stripeCustomerId = await ensureStripeCustomer(supabase, userId);
  if (!stripeCustomerId) throw new Error("STRIPE_NOT_CONFIGURED");

  const stripe = getStripe();
  await stripe.customers.update(stripeCustomerId, {
    invoice_settings: { default_payment_method: pmId },
  });

  await supabase
    .from("payment_methods")
    .update({ is_default: false, updated_at: new Date().toISOString() })
    .eq("customer_id", userId);

  const { error: updateErr } = await supabase
    .from("payment_methods")
    .update({ is_default: true, updated_at: new Date().toISOString() })
    .eq("id", methodId)
    .eq("customer_id", userId);
  if (updateErr) throw new Error(updateErr.message);
}

export async function removePaymentMethod(
  supabase: SupabaseClient,
  userId: string,
  methodId: string,
): Promise<void> {
  const { data: row, error } = await supabase
    .from("payment_methods")
    .select("id, provider_payment_method_id, is_default")
    .eq("id", methodId)
    .eq("customer_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error("PAYMENT_METHOD_NOT_FOUND");

  const pmId = String(row.provider_payment_method_id || "").trim();
  if (pmId) {
    const stripe = getStripe();
    try {
      await stripe.paymentMethods.detach(pmId);
    } catch {
      // Already detached in Stripe — still remove local row.
    }
  }

  const { error: delErr } = await supabase
    .from("payment_methods")
    .delete()
    .eq("id", methodId)
    .eq("customer_id", userId);
  if (delErr) throw new Error(delErr.message);

  if (row.is_default) {
    const remaining = await listCustomerPaymentMethods(supabase, userId);
    if (remaining.length > 0) {
      await setDefaultPaymentMethod(supabase, userId, remaining[0].id);
    }
  }
}
