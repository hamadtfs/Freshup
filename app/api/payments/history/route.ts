import { createAdminClient } from "@/lib/supabase/server";
import { getUserIdFromBearer } from "@/lib/supabase/route-user";
import { paymentStatusLabel } from "@/lib/payments/payment-status-label";
import { resolveServiceDisplayNames } from "@/lib/service-id";
import { NextRequest, NextResponse } from "next/server";

function formatUiDate(iso: string | null | undefined, language: "en" | "no") {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(language === "en" ? "en-GB" : "nb-NO", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatUiTime(iso: string | null | undefined, language: "en" | "no") {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString(language === "en" ? "en-GB" : "nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function displayStatus(
  lock: {
    payment_status?: string | null;
    payment_captured_at?: string | null;
    payment_authorized_at?: string | null;
  },
  language: "en" | "no",
): string {
  if (lock.payment_captured_at) {
    return paymentStatusLabel("captured", language);
  }
  if (lock.payment_authorized_at) {
    return paymentStatusLabel(lock.payment_status || "authorized", language);
  }
  return paymentStatusLabel(lock.payment_status, language);
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient();
    const userId = await getUserIdFromBearer(supabase, req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const language = req.nextUrl.searchParams.get("lang") === "en" ? "en" : "no";

    const { data: locks, error } = await supabase
      .from("booking_price_locks")
      .select(
        "id, order_id, service_id, payment_status, payment_authorized_amount, payment_authorized_at, payment_captured_amount, payment_captured_at, currency, locked_at, delivery_fee, customer_total",
      )
      .eq("customer_id", userId)
      .or(
        "payment_authorized_at.not.is.null,payment_captured_at.not.is.null,stripe_payment_intent_id.not.is.null",
      )
      .order("locked_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    const rows = locks ?? [];
    const serviceIds = [
      ...new Set(rows.map((r) => String(r.service_id || "")).filter(Boolean)),
    ];
    const orderIds = [
      ...new Set(rows.map((r) => String(r.order_id || "")).filter(Boolean)),
    ];

    const [serviceNameById, { data: orders }] = await Promise.all([
      resolveServiceDisplayNames(supabase, serviceIds),
      orderIds.length
        ? supabase.from("orders").select("id, status").in("id", orderIds)
        : Promise.resolve({ data: [] as { id: string; status: string }[] }),
    ]);

    const orderStatusById = new Map(
      (orders ?? []).map((o) => [String(o.id), String(o.status || "")]),
    );

    const transactions = rows.map((lock) => {
      const whenIso =
        lock.payment_captured_at ||
        lock.payment_authorized_at ||
        lock.locked_at;
      const amount =
        lock.payment_captured_amount != null
          ? Number(lock.payment_captured_amount)
          : Number(lock.payment_authorized_amount) || 0;
      const serviceId = String(lock.service_id || "");

      return {
        id: lock.id,
        order_id: lock.order_id,
        service_name: serviceNameById.get(serviceId) || "—",
        amount: Math.round(amount),
        total: Math.round(Number(lock.customer_total) || amount),
        delivery_fee: Math.round(Number(lock.delivery_fee) || 0),
        currency: String(lock.currency || "nok").toUpperCase(),
        status: displayStatus(lock, language),
        order_status: lock.order_id
          ? orderStatusById.get(String(lock.order_id)) || null
          : null,
        ui_date: formatUiDate(whenIso, language),
        ui_time: formatUiTime(whenIso, language),
      };
    });

    return NextResponse.json({ transactions });
  } catch (error) {
    console.error("[payments/history]", error);
    return NextResponse.json(
      { error: "Failed to load payment history" },
      { status: 500 },
    );
  }
}
