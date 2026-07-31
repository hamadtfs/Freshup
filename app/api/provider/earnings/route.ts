import { createAdminClient } from "@/lib/supabase/server";
import { getUserIdFromBearer } from "@/lib/supabase/route-user";
import {
  formatTxDate,
  formatTxShortDate,
  formatTxTime,
} from "@/lib/payments/format-tx-datetime";
import { resolveServiceDisplayNames, serviceIdCandidates } from "@/lib/service-id";
import { NextRequest, NextResponse } from "next/server";

function periodStart(period: string): Date {
  const now = new Date();
  if (period === "year") {
    const start = new Date(now.getFullYear(), 0, 1);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  if (period === "week") {
    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
  if (period === "month") {
    return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient();
    const providerId = await getUserIdFromBearer(supabase, req);
    if (!providerId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = req.nextUrl.searchParams;
    const periodParam = params.get("period");
    const period =
      periodParam === "week" ||
      periodParam === "month" ||
      periodParam === "year"
        ? periodParam
        : "day";
    const language = params.get("lang") === "en" ? "en" : "no";
    const since = periodStart(period).toISOString();

    const [{ data: orders, error }, { data: payouts }] = await Promise.all([
      supabase
        .from("orders")
        .select("id, service_id, customer_id, completed_at")
        .eq("provider_id", providerId)
        .eq("status", "completed")
        .gte("completed_at", since)
        .order("completed_at", { ascending: false })
        .limit(60),
      supabase
        .from("payouts")
        .select("id, amount, fee, payout_type, created_at")
        .eq("provider_id", providerId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    if (error) throw error;

    const rows = orders ?? [];
    const orderIds = rows.map((o) => o.id);
    const serviceIds = [
      ...new Set(rows.map((o) => String(o.service_id || "")).filter(Boolean)),
    ];
    const customerIds = [
      ...new Set(rows.map((o) => String(o.customer_id || "")).filter(Boolean)),
    ];

    const serviceLookupIds = [
      ...new Set(serviceIds.flatMap((id) => serviceIdCandidates(id))),
    ];

    const [{ data: locks }, serviceDisplayNames, { data: services }, { data: profiles }] =
      await Promise.all([
        orderIds.length
          ? supabase
              .from("booking_price_locks")
              .select("order_id, provider_total")
              .in("order_id", orderIds)
          : Promise.resolve({
              data: [] as { order_id: string; provider_total: number }[],
            }),
        resolveServiceDisplayNames(supabase, serviceIds),
        serviceLookupIds.length
          ? supabase
              .from("services")
              .select("id, duration_minutes")
              .in("id", serviceLookupIds)
          : Promise.resolve({
              data: [] as { id: string; duration_minutes: number }[],
            }),
        customerIds.length
          ? supabase
              .from("profiles")
              .select("id, display_name")
              .in("id", customerIds)
          : Promise.resolve({
              data: [] as { id: string; display_name: string | null }[],
            }),
      ]);

    const lockByOrder = new Map(
      (locks ?? []).map((l) => [
        String(l.order_id),
        Number(l.provider_total) || 0,
      ]),
    );
    const durationByServiceId = new Map(
      (services ?? []).map((s) => [
        String(s.id),
        Number(s.duration_minutes) || 0,
      ]),
    );
    const resolveDuration = (serviceId: string) => {
      for (const candidate of serviceIdCandidates(serviceId)) {
        const mins = durationByServiceId.get(candidate);
        if (mins != null && mins > 0) return mins;
      }
      return 0;
    };
    const profileById = new Map(
      (profiles ?? []).map((p) => [
        String(p.id),
        String(p.display_name || "").trim(),
      ]),
    );

    const earningTransactions = rows.map((o) => {
      const amount = Math.round(lockByOrder.get(String(o.id)) || 0);
      const completedAt = String(o.completed_at || "");
      const serviceId = String(o.service_id || "");
      return {
        id: `earning-${o.id}`,
        kind: "earning" as const,
        service_name: serviceDisplayNames.get(serviceId) || "—",
        customer_name:
          profileById.get(String(o.customer_id || "")) ||
          (language === "en" ? "Customer" : "Kunde"),
        amount,
        fee: 0,
        date: formatTxDate(completedAt, language),
        time: formatTxTime(completedAt),
        sort_at: completedAt,
      };
    });

    const payoutTransactions = (payouts ?? []).map((p) => {
      const payoutType = String(p.payout_type || "automatic");
      const isInstant = payoutType === "instant";
      const createdAt = String(p.created_at || "");
      const amount = Number(p.amount) || 0;
      const fee = Number(p.fee) || 0;
      return {
        id: `payout-${p.id}`,
        kind: "payout" as const,
        service_name: isInstant
          ? language === "en"
            ? "Instant payout"
            : "Umiddelbar utbetaling"
          : language === "en"
            ? "Automatic payout"
            : "Automatisk utbetaling",
        customer_name:
          fee > 0
            ? language === "en"
              ? `Fee: ${fee} NOK`
              : `Gebyr: ${fee} kr`
            : "",
        amount,
        fee,
        date: formatTxShortDate(createdAt, language),
        time: formatTxTime(createdAt),
        sort_at: createdAt,
      };
    });

    const transactions = [...earningTransactions, ...payoutTransactions]
      .sort(
        (a, b) =>
          new Date(b.sort_at).getTime() - new Date(a.sort_at).getTime(),
      )
      .map(({ sort_at: _sortAt, ...tx }) => tx);

    const total = earningTransactions.reduce((sum, t) => sum + t.amount, 0);
    const jobs = earningTransactions.length;
    const durationMin = rows.reduce(
      (sum, o) => sum + resolveDuration(String(o.service_id || "")),
      0,
    );

    return NextResponse.json({
      period,
      summary: {
        total,
        jobs,
        avg_per_job: jobs > 0 ? Math.round(total / jobs) : 0,
        hours: Math.round((durationMin / 60) * 10) / 10,
      },
      transactions,
    });
  } catch (e) {
    console.error("[provider/earnings]", e);
    return NextResponse.json(
      { error: "Failed to load earnings" },
      { status: 500 },
    );
  }
}
