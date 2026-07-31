import { createAdminClient } from "@/lib/supabase/server";
import { getUserIdFromBearer } from "@/lib/supabase/route-user";
import { paymentStatusLabel } from "@/lib/payments/payment-status-label";
import {
  resolveTransactionPaymentMethod,
  resolveTransactionReceiptUrl,
} from "@/lib/payments/transaction-detail";
import { resolveServiceDisplayName } from "@/lib/service-id";
import { NextRequest, NextResponse } from "next/server";

type RouteContext = { params: Promise<{ id: string }> };

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

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const supabase = createAdminClient();
    const userId = await getUserIdFromBearer(supabase, req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const transactionId = String(id || "").trim();
    if (!transactionId) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const language = req.nextUrl.searchParams.get("lang") === "en" ? "en" : "no";

    const { data: lock, error } = await supabase
      .from("booking_price_locks")
      .select(
        "id, order_id, service_id, customer_id, payment_status, payment_authorized_amount, payment_authorized_at, payment_captured_amount, payment_captured_at, currency, locked_at, delivery_fee, customer_total, customer_service_price, addons_customer_total, stripe_payment_intent_id",
      )
      .eq("id", transactionId)
      .eq("customer_id", userId)
      .maybeSingle();

    if (error) throw error;
    if (!lock) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    const whenIso =
      lock.payment_captured_at ||
      lock.payment_authorized_at ||
      lock.locked_at;
    const chargedAmount =
      lock.payment_captured_amount != null
        ? Number(lock.payment_captured_amount)
        : Number(lock.payment_authorized_amount) || 0;

    const [serviceName, paymentMethod, receiptUrl] = await Promise.all([
      resolveServiceDisplayName(supabase, lock.service_id),
      resolveTransactionPaymentMethod(lock.stripe_payment_intent_id),
      resolveTransactionReceiptUrl(lock.stripe_payment_intent_id),
    ]);

    return NextResponse.json({
      transaction: {
        id: lock.id,
        order_id: lock.order_id,
        service_name: serviceName,
        total: Math.round(Number(lock.customer_total) || chargedAmount),
        amount: Math.round(chargedAmount),
        delivery_fee: Math.round(Number(lock.delivery_fee) || 0),
        service_price: Math.round(Number(lock.customer_service_price) || 0),
        addons_total: Math.round(Number(lock.addons_customer_total) || 0),
        currency: String(lock.currency || "nok").toUpperCase(),
        status: displayStatus(lock, language),
        payment_method: paymentMethod,
        receipt_url: receiptUrl,
        ui_date: formatUiDate(whenIso, language),
        ui_time: formatUiTime(whenIso, language),
        invoice_reference: lock.order_id
          ? String(lock.order_id).slice(0, 8).toUpperCase()
          : String(lock.id).slice(0, 8).toUpperCase(),
      },
    });
  } catch (error) {
    console.error("[payments/history/[id]]", error);
    return NextResponse.json(
      { error: "Failed to load transaction" },
      { status: 500 },
    );
  }
}
