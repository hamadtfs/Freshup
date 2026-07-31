import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripe, isStripeConfigured, toStripeMinorUnits } from "./stripe";
import {
  INSTANT_PAYOUT_FEE_NOK,
  type PayoutType,
  getProviderAvailableBalance,
} from "./provider-wallet";

type PayoutInsert = {
  provider_id: string;
  amount: number;
  currency: string;
  status: "pending" | "in_transit" | "paid" | "failed";
  payout_type: PayoutType;
  fee: number;
  provider_payout_id?: string | null;
};

async function insertLedgerPayout(
  supabase: SupabaseClient,
  providerId: string,
  amount: number,
  description: string,
): Promise<void> {
  try {
    await supabase.from("provider_earnings_ledger").insert({
      provider_id: providerId,
      entry_type: "payout",
      amount: -Math.abs(amount),
      currency: "NOK",
      description,
    });
  } catch {
    // audit-only
  }
}

async function insertLedgerEarning(
  supabase: SupabaseClient,
  providerId: string,
  orderId: string,
  amount: number,
  description: string,
): Promise<void> {
  const { data: existing } = await supabase
    .from("provider_earnings_ledger")
    .select("id")
    .eq("provider_id", providerId)
    .eq("order_id", orderId)
    .eq("entry_type", "earning")
    .maybeSingle();

  if (existing?.id) return;

  try {
    await supabase.from("provider_earnings_ledger").insert({
      provider_id: providerId,
      order_id: orderId,
      entry_type: "earning",
      amount: Math.abs(amount),
      currency: "NOK",
      description,
    });
  } catch {
    // audit-only
  }
}

export async function recordProviderEarningForOrder(
  supabase: SupabaseClient,
  providerId: string,
  orderId: string,
): Promise<void> {
  const { data: lock } = await supabase
    .from("booking_price_locks")
    .select("provider_total")
    .eq("order_id", orderId)
    .maybeSingle();

  const amount = Math.round(Number(lock?.provider_total) || 0);
  if (amount <= 0) return;

  const { data: order } = await supabase
    .from("orders")
    .select("service_id")
    .eq("id", orderId)
    .maybeSingle();

  let serviceName = "Service";
  if (order?.service_id) {
    const { data: service } = await supabase
      .from("services")
      .select("name")
      .eq("id", order.service_id)
      .maybeSingle();
    serviceName = String(service?.name || serviceName);
  }

  await insertLedgerEarning(
    supabase,
    providerId,
    orderId,
    amount,
    serviceName,
  );
}

async function triggerStripePayout(
  stripeAccountId: string,
  netAmountKr: number,
  instant: boolean,
): Promise<string | null> {
  if (!isStripeConfigured() || !stripeAccountId || netAmountKr <= 0) {
    return null;
  }

  try {
    const stripe = getStripe();
    const payout = await stripe.payouts.create(
      {
        amount: toStripeMinorUnits(netAmountKr),
        currency: "nok",
        method: instant ? "instant" : "standard",
      },
      { stripeAccount: stripeAccountId },
    );
    return payout.id;
  } catch (e) {
    console.error("[provider-payout] stripe payout failed", e);
    return null;
  }
}

export async function createProviderPayout(
  supabase: SupabaseClient,
  providerId: string,
  payoutType: PayoutType,
): Promise<{
  ok: boolean;
  error?: string;
  payout?: PayoutInsert & { id: string; created_at: string };
}> {
  const balance = await getProviderAvailableBalance(supabase, providerId);
  if (balance <= 0) {
    return { ok: false, error: "NO_BALANCE" };
  }

  const fee = payoutType === "instant" ? INSTANT_PAYOUT_FEE_NOK : 0;
  if (payoutType === "instant" && balance <= fee) {
    return { ok: false, error: "BALANCE_TOO_LOW" };
  }

  const grossAmount = balance;
  const netToBank = grossAmount - fee;

  const { data: provider } = await supabase
    .from("provider_details")
    .select("stripe_account_id, stripe_onboarded")
    .eq("id", providerId)
    .maybeSingle();

  const stripeAccountId = String(provider?.stripe_account_id || "").trim();
  const stripePayoutId = await triggerStripePayout(
    stripeAccountId,
    netToBank,
    payoutType === "instant",
  );

  const status =
    stripeAccountId && !stripePayoutId && isStripeConfigured()
      ? "failed"
      : payoutType === "instant"
        ? "paid"
        : "pending";

  const row: PayoutInsert = {
    provider_id: providerId,
    amount: grossAmount,
    currency: "NOK",
    status,
    payout_type: payoutType,
    fee,
    provider_payout_id: stripePayoutId,
  };

  const { data: payout, error } = await supabase
    .from("payouts")
    .insert(row)
    .select("id, created_at")
    .single();

  if (error || !payout) {
    return { ok: false, error: error?.message || "PAYOUT_INSERT_FAILED" };
  }

  const label =
    payoutType === "instant" ? "Instant payout" : "Automatic payout";
  await insertLedgerPayout(supabase, providerId, grossAmount, label);

  return {
    ok: true,
    payout: {
      ...row,
      id: String(payout.id),
      created_at: String(payout.created_at),
    },
  };
}

export async function runAutomaticPayoutsForAllProviders(
  supabase: SupabaseClient,
): Promise<{ processed: number; paid: number; skipped: number }> {
  const { data: providers } = await supabase
    .from("provider_details")
    .select("id");

  let processed = 0;
  let paid = 0;
  let skipped = 0;

  for (const provider of providers ?? []) {
    const providerId = String(provider.id);
    const balance = await getProviderAvailableBalance(supabase, providerId);
    processed += 1;
    if (balance <= 0) {
      skipped += 1;
      continue;
    }

    const result = await createProviderPayout(
      supabase,
      providerId,
      "automatic",
    );
    if (result.ok) paid += 1;
    else skipped += 1;
  }

  return { processed, paid, skipped };
}
