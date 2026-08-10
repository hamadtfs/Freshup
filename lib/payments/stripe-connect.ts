import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { getStripe, isStripeConfigured } from "./stripe";
import { forceProviderOffline } from "./provider-eligibility";
import { formatStripeConnectStartError } from "./stripe-connect-errors";

export {
  formatStripeConnectStartError,
  isStripeConnectSetupError,
  stripeConnectStartUserMessage,
} from "./stripe-connect-errors";

const DEFAULT_COUNTRY = "NO";

function appBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_URL ||
    "http://localhost:3000";
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw.replace(/\/$/, "");
  }
  return `https://${raw}`.replace(/\/$/, "");
}

export async function ensureStripeConnectAccount(
  supabase: SupabaseClient,
  providerId: string,
  opts?: { email?: string | null },
): Promise<string> {
  if (!isStripeConfigured()) {
    throw new Error("STRIPE_NOT_CONFIGURED");
  }

  const { data: provider, error } = await supabase
    .from("provider_details")
    .select("id, stripe_account_id")
    .eq("id", providerId)
    .maybeSingle();

  if (error || !provider) {
    throw new Error("PROVIDER_NOT_FOUND");
  }

  const existing = String(provider.stripe_account_id || "").trim();
  if (existing) return existing;

  const stripe = getStripe();
  let account: Stripe.Account;
  try {
    account = await stripe.accounts.create({
      type: "express",
      country: DEFAULT_COUNTRY,
      email: opts?.email || undefined,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_type: "individual",
      metadata: {
        freshup_provider_id: providerId,
      },
    });
  } catch (e) {
    throw new Error(formatStripeConnectStartError(e));
  }

  const { error: updateErr } = await supabase
    .from("provider_details")
    .update({
      stripe_account_id: account.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", providerId);

  if (updateErr) {
    throw new Error(updateErr.message || "FAILED_TO_SAVE_STRIPE_ACCOUNT");
  }

  return account.id;
}

export async function createStripeConnectAccountLink(
  stripeAccountId: string,
  opts?: { returnUrl?: string | null; refreshUrl?: string | null },
): Promise<string> {
  if (!isStripeConfigured()) {
    throw new Error("STRIPE_NOT_CONFIGURED");
  }

  const base = appBaseUrl();
  const returnUrl =
    String(opts?.returnUrl || "").trim() ||
    `${base}/?stripe_connect=return`;
  const refreshUrl =
    String(opts?.refreshUrl || "").trim() ||
    `${base}/?stripe_connect=refresh`;

  const stripe = getStripe();
  const link = await stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });

  return link.url;
}

export async function syncProviderFromStripeAccount(
  supabase: SupabaseClient,
  account: Stripe.Account,
): Promise<{ providerId: string | null }> {
  const accountId = account.id;
  const chargesEnabled = Boolean(account.charges_enabled);
  const payoutsEnabled = Boolean(account.payouts_enabled);
  const onboarded = chargesEnabled && payoutsEnabled;
  const now = new Date().toISOString();

  let providerId =
    String(account.metadata?.freshup_provider_id || "").trim() || null;

  if (!providerId) {
    const { data: row } = await supabase
      .from("provider_details")
      .select("id")
      .eq("stripe_account_id", accountId)
      .maybeSingle();
    providerId = row?.id ? String(row.id) : null;
  }

  if (!providerId) {
    console.warn(
      "[stripe-connect] account.updated with unknown provider",
      accountId,
    );
    return { providerId: null };
  }

  const { error: updateErr } = await supabase
    .from("provider_details")
    .update({
      stripe_account_id: accountId,
      stripe_charges_enabled: chargesEnabled,
      stripe_payouts_enabled: payoutsEnabled,
      stripe_onboarded: onboarded,
      updated_at: now,
    })
    .eq("id", providerId);

  if (updateErr) {
    throw new Error(updateErr.message || "FAILED_TO_SYNC_CONNECT");
  }

  // Reflect bank last4 when available (Connect external account).
  try {
    const external = account.external_accounts?.data?.[0] as
      | { last4?: string; object?: string }
      | undefined;
    if (external?.last4) {
      await supabase
        .from("provider_details")
        .update({ bank_account_last4: String(external.last4) })
        .eq("id", providerId);
    }
  } catch {
    // optional
  }

  const verificationStatus = onboarded ? "approved" : "pending";
  const { error: verErr } = await supabase.from("provider_verifications").upsert(
    {
      provider_id: providerId,
      status: verificationStatus,
      source: "stripe",
      updated_at: now,
      reviewed_at: onboarded ? now : null,
      review_notes: onboarded
        ? "Stripe Connect: charges_enabled + payouts_enabled"
        : "Stripe Connect onboarding incomplete",
    },
    { onConflict: "provider_id" },
  );
  if (verErr) {
    console.error("[stripe-connect] verification upsert failed", verErr);
  }

  if (!payoutsEnabled) {
    await forceProviderOffline(supabase, providerId);
  }

  return { providerId };
}

export async function retrieveAndSyncStripeAccount(
  supabase: SupabaseClient,
  stripeAccountId: string,
): Promise<{ providerId: string | null }> {
  if (!isStripeConfigured()) {
    throw new Error("STRIPE_NOT_CONFIGURED");
  }
  const stripe = getStripe();
  const account = await stripe.accounts.retrieve(stripeAccountId);
  return syncProviderFromStripeAccount(supabase, account);
}
