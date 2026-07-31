import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripe, isStripeConfigured } from "@/lib/payments/stripe";

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

  const stored = String(existing?.stripe_customer_id || "").trim();
  if (stored) return stored;

  const { data: authUser } = await supabase.auth.admin.getUserById(userId);
  const email = authUser?.user?.email ?? undefined;
  const phone = authUser?.user?.phone ?? undefined;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: email || undefined,
    phone: phone || undefined,
    metadata: { supabase_user_id: userId },
  });

  await supabase.from("customer_details").upsert(
    { id: userId, stripe_customer_id: customer.id },
    { onConflict: "id" },
  );

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
