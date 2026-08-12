/**
 * Cancel Stripe holds on expired booking_price_locks that never became an order.
 * Cleans the known 8 Jul / 22 Jul 2026 rows when they still match.
 *
 * Dry-run (default):
 *   node --env-file=.env scripts/release-orphaned-auths.mjs
 *
 * Apply:
 *   node --env-file=.env scripts/release-orphaned-auths.mjs --apply
 *
 * Against a running API (uses CRON_SECRET):
 *   node --env-file=.env scripts/release-orphaned-auths.mjs --apply --http
 */
const baseUrl = String(process.env.APP_BASE_URL || "http://localhost:3000").replace(
  /\/+$/,
  "",
);
const cronSecret = process.env.CRON_SECRET || "";
const apply = process.argv.includes("--apply");
const useHttp = process.argv.includes("--http");

async function viaHttp() {
  const url = `${baseUrl}/api/cron/release-orphaned-auths?${apply ? "" : "dryRun=1"}`;
  const headers = {
    "content-type": "application/json",
    ...(cronSecret ? { authorization: `Bearer ${cronSecret}` } : {}),
  };
  const res = await fetch(url, { method: "POST", headers, body: "{}" });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[release-orphaned-auths] ${res.status}: ${text}`);
    process.exit(1);
  }
  console.log(text);
}

async function viaDirect() {
  const { createClient } = await import("@supabase/supabase-js");
  const Stripe = (await import("stripe")).default;

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!url || !key) {
    console.error("Need NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  if (apply && !stripeKey) {
    console.error("Need STRIPE_SECRET_KEY to cancel PaymentIntents");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const stripe = stripeKey
    ? new Stripe(stripeKey, { apiVersion: "2024-06-20" })
    : null;

  const { data, error } = await supabase
    .from("booking_price_locks")
    .select(
      "id, customer_id, order_id, stripe_payment_intent_id, payment_authorized_at, payment_captured_at, payment_status, expires_at, locked_at",
    )
    .is("order_id", null)
    .not("payment_authorized_at", "is", null)
    .is("payment_captured_at", null)
    .not("stripe_payment_intent_id", "is", null)
    .order("payment_authorized_at", { ascending: true })
    .limit(50);
  if (error) throw error;

  const now = Date.now();
  const locks = (data ?? []).filter((row) => {
    const status = String(row.payment_status || "").toLowerCase();
    if (status === "canceled" || status === "cancelled") return false;
    const expiresAt = new Date(String(row.expires_at || "")).getTime();
    if (Number.isFinite(expiresAt)) return expiresAt < now;
    const lockedAt = new Date(
      String(row.locked_at || row.payment_authorized_at),
    ).getTime();
    return Number.isFinite(lockedAt) && lockedAt + 15 * 60 * 1000 < now;
  });

  console.log(
    `[release-orphaned-auths] ${apply ? "apply" : "dry-run"} candidates=${locks.length}`,
  );
  for (const row of locks) {
    console.log(
      `  ${row.id} authorized_at=${row.payment_authorized_at} pi=${row.stripe_payment_intent_id} status=${row.payment_status}`,
    );
    if (!apply || !stripe) continue;

    const intentId = row.stripe_payment_intent_id;
    try {
      const pi = await stripe.paymentIntents.retrieve(intentId);
      if (
        pi.status === "requires_capture" ||
        pi.status === "requires_confirmation" ||
        pi.status === "requires_payment_method" ||
        pi.status === "requires_action"
      ) {
        await stripe.paymentIntents.cancel(intentId);
      }
    } catch (e) {
      console.error(`  cancel failed for ${row.id}:`, e instanceof Error ? e.message : e);
    }

    const { error: updateErr } = await supabase
      .from("booking_price_locks")
      .update({ payment_status: "canceled" })
      .eq("id", row.id);
    if (updateErr) {
      console.error(`  db update failed for ${row.id}:`, updateErr.message);
    }
  }
}

if (useHttp) {
  await viaHttp();
} else {
  await viaDirect();
}
