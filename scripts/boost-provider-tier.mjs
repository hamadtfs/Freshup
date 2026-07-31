/**
 * Boost a provider's rolling stats to Gold (score 70+).
 * Usage: node --env-file=.env scripts/boost-provider-tier.mjs [provider_id]
 */
import { createClient } from "@supabase/supabase-js";

const providerId =
  process.argv[2] || "8a086479-1a06-4ea8-bf23-97d43c8511c1";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const cutoffIso = new Date(
  Date.now() - 30 * 24 * 60 * 60 * 1000,
).toISOString();

async function main() {
  const { data: offers, error: offersErr } = await supabase
    .from("order_offers")
    .select("id, order_id, created_at")
    .eq("provider_id", providerId)
    .gte("created_at", cutoffIso);
  if (offersErr) throw offersErr;

  console.log(`Offers in window: ${offers?.length ?? 0}`);

  for (const row of offers ?? []) {
    const created = new Date(row.created_at);
    const responded = new Date(created.getTime() + 2000).toISOString();
    const { error } = await supabase
      .from("order_offers")
      .update({ status: "accepted", responded_at: responded })
      .eq("id", row.id);
    if (error) throw error;
  }

  const orderIds = [...new Set((offers ?? []).map((o) => o.order_id).filter(Boolean))];
  if (orderIds.length > 0) {
    const completedAt = new Date(Date.now() - 86400000).toISOString();
    const { error: ordersErr } = await supabase
      .from("orders")
      .update({
        status: "completed",
        completed_at: completedAt,
        provider_id: providerId,
      })
      .in("id", orderIds);
    if (ordersErr) throw ordersErr;
    console.log(`Marked ${orderIds.length} orders completed`);
  }

  const { error: tierErr } = await supabase
    .from("provider_details")
    .update({ dispatch_performance_tier: "gold" })
    .eq("id", providerId);
  if (tierErr) throw tierErr;

  const { data: checkOffers } = await supabase
    .from("order_offers")
    .select("status, created_at, responded_at")
    .eq("provider_id", providerId)
    .gte("created_at", cutoffIso);

  const { data: completedOrders } = await supabase
    .from("orders")
    .select("id, completed_at, accepted_at")
    .eq("provider_id", providerId)
    .eq("status", "completed");

  const received = checkOffers?.length ?? 0;
  const accepted =
    checkOffers?.filter((o) => o.status === "accepted").length ?? 0;
  const cutoffMs = new Date(cutoffIso).getTime();
  const completed = (completedOrders ?? []).filter((r) => {
    const at = r.completed_at || r.accepted_at;
    if (!at) return false;
    return new Date(at).getTime() >= cutoffMs;
  }).length;

  let speedPoints = 0;
  for (const o of checkOffers ?? []) {
    if (!o.responded_at) continue;
    const sec =
      (new Date(o.responded_at).getTime() - new Date(o.created_at).getTime()) /
      1000;
    if (sec <= 3) speedPoints += 1;
    else if (sec <= 6) speedPoints += 0.5;
    else if (sec <= 9) speedPoints += 0.25;
  }

  const score =
    received >= 3
      ? Math.round(
          ((accepted / received +
            completed / received +
            speedPoints / received) /
            3) *
            100,
        )
      : 50;
  const tier = score >= 70 ? "gold" : score >= 50 ? "silver" : "bronze";

  console.log({
    providerId,
    received,
    accepted,
    completed,
    score,
    tier,
    dispatch_performance_tier: "gold",
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
