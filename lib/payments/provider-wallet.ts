import type { SupabaseClient } from "@supabase/supabase-js";

export const INSTANT_PAYOUT_FEE_NOK = 10;
export const AUTOMATIC_PAYOUT_HOUR_OSLO = 9;
export const AUTOMATIC_PAYOUT_TIMEZONE = "Europe/Oslo";

export type PayoutType = "automatic" | "instant";
export type PayoutStatus = "pending" | "in_transit" | "paid" | "failed";

export type ProviderPayoutRow = {
  id: string;
  provider_id: string;
  amount: number;
  currency: string;
  status: PayoutStatus;
  payout_type: PayoutType;
  fee: number;
  provider_payout_id: string | null;
  created_at: string;
};

const OSLO_WEEKDAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: AUTOMATIC_PAYOUT_TIMEZONE,
  weekday: "short",
});

function osloOffsetMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: AUTOMATIC_PAYOUT_TIMEZONE,
    timeZoneName: "shortOffset",
  }).formatToParts(date);
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+1";
  const match = tz.match(/GMT([+-]\d+)(?::(\d+))?/);
  if (!match) return 60;
  const hours = Number(match[1]);
  const mins = Number(match[2] || 0);
  return hours * 60 + Math.sign(hours) * mins;
}

function osloWeekday(date: Date): string {
  return OSLO_WEEKDAY_FORMATTER.format(date);
}

/** Next Monday 09:00 Europe/Oslo (inclusive of today if it is Monday before 09:00). */
export function getNextAutomaticPayoutDate(from: Date = new Date()): Date {
  for (let daysAhead = 0; daysAhead <= 7; daysAhead += 1) {
    const probe = new Date(from.getTime() + daysAhead * 86_400_000);
    if (osloWeekday(probe) !== "Mon") continue;

    const ymd = probe.toLocaleDateString("en-CA", {
      timeZone: AUTOMATIC_PAYOUT_TIMEZONE,
    });
    const offsetMin = osloOffsetMinutes(probe);
    const sign = offsetMin >= 0 ? "+" : "-";
    const abs = Math.abs(offsetMin);
    const oh = String(Math.floor(abs / 60)).padStart(2, "0");
    const om = String(abs % 60).padStart(2, "0");
    const payoutAt = new Date(
      `${ymd}T0${AUTOMATIC_PAYOUT_HOUR_OSLO}:00:00${sign}${oh}:${om}`,
    );
    if (payoutAt > from) return payoutAt;
  }

  const fallback = new Date(from.getTime() + 7 * 86_400_000);
  fallback.setHours(AUTOMATIC_PAYOUT_HOUR_OSLO, 0, 0, 0);
  return fallback;
}

export function formatNextPayoutLabel(
  date: Date,
  language: "en" | "no",
): string {
  const weekday = date.toLocaleDateString(language === "en" ? "en-GB" : "nb-NO", {
    weekday: "long",
    timeZone: AUTOMATIC_PAYOUT_TIMEZONE,
  });
  const time = `${String(AUTOMATIC_PAYOUT_HOUR_OSLO).padStart(2, "0")}:00`;
  return language === "en"
    ? `${weekday} · ${time}`
    : `${weekday} · ${time}`;
}

export async function sumProviderEarnings(
  supabase: SupabaseClient,
  providerId: string,
): Promise<number> {
  const { data: orders } = await supabase
    .from("orders")
    .select("id")
    .eq("provider_id", providerId)
    .eq("status", "completed");

  const orderIds = (orders ?? []).map((o) => String(o.id));
  if (!orderIds.length) return 0;

  const { data: locks } = await supabase
    .from("booking_price_locks")
    .select("provider_total")
    .in("order_id", orderIds);

  return (locks ?? []).reduce(
    (sum, row) => sum + (Number(row.provider_total) || 0),
    0,
  );
}

export async function sumProviderPaidOut(
  supabase: SupabaseClient,
  providerId: string,
): Promise<number> {
  const { data: payouts } = await supabase
    .from("payouts")
    .select("amount, status")
    .eq("provider_id", providerId)
    .in("status", ["pending", "in_transit", "paid"]);

  return (payouts ?? []).reduce(
    (sum, row) => sum + (Number(row.amount) || 0),
    0,
  );
}

export async function getProviderAvailableBalance(
  supabase: SupabaseClient,
  providerId: string,
): Promise<number> {
  const [earned, paidOut] = await Promise.all([
    sumProviderEarnings(supabase, providerId),
    sumProviderPaidOut(supabase, providerId),
  ]);
  return Math.max(0, Math.round(earned - paidOut));
}

export async function getProviderBankLast4(
  supabase: SupabaseClient,
  providerId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("provider_details")
    .select("bank_account_last4, stripe_account_id, stripe_onboarded")
    .eq("id", providerId)
    .maybeSingle();

  const last4 = String(data?.bank_account_last4 || "").trim();
  if (last4) return last4.slice(-4);

  return null;
}

export function maskBankAccount(last4: string | null): string {
  if (!last4) return "•••• —";
  return `•••• ${last4.slice(-4)}`;
}
