import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripe, isStripeConfigured } from "@/lib/payments/stripe";

async function clearLocalPaymentMethods(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  await supabase.from("payment_methods").delete().eq("customer_id", userId);
}

/**
 * Ensure this Fresh Up user has a valid Stripe Customer for the *current*
 * STRIPE_SECRET_KEY. If the stored id is missing/deleted/from another
 * Stripe account (test↔live switch), create a new customer and drop stale
 * local payment_methods rows so we never charge a PM against the wrong cus_.
 */
export async function ensureStripeCustomer(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  if (!isStripeConfigured()) return null;

  const { data: existing } = await supabase
    .from("customer_details")
    .select("stripe_customer_id")
    .eq("id", userId)
    .maybeSingle();

  const stripe = getStripe();
  const stored = String(existing?.stripe_customer_id || "").trim();
  if (stored) {
    try {
      const existingCustomer = await stripe.customers.retrieve(stored);
      if (!("deleted" in existingCustomer && existingCustomer.deleted)) {
        return stored;
      }
    } catch {
      // Stored customer id is stale (switched test/live keys or account).
      // Fall through and create a fresh Stripe customer for this user.
    }
  }

  // Recreating the Stripe customer — old PaymentMethods belong to the previous
  // cus_ and will fail with "does not belong to the Customer you supplied".
  await clearLocalPaymentMethods(supabase, userId);

  const { data: authUser } = await supabase.auth.admin.getUserById(userId);
  const email = authUser?.user?.email ?? undefined;
  const phone = authUser?.user?.phone ?? undefined;

  const customer = await stripe.customers.create({
    email: email || undefined,
    phone: phone || undefined,
    metadata: { supabase_user_id: userId },
  });

  await supabase.from("customer_details").upsert(
    { id: userId, stripe_customer_id: customer.id },
    { onConflict: "id" },
  );

  await supabase.rpc("upsert_account_role_grant", {
    p_user_id: userId,
    p_role: "customer",
    p_status: "active",
    p_activate: true,
  });

  return customer.id;
}

export async function getStripeCustomerId(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("customer_details")
    .select("stripe_customer_id")
    .eq("id", userId)
    .maybeSingle();
  const id = String(data?.stripe_customer_id || "").trim();
  return id || null;
}
