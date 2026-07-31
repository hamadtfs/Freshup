import { createAdminClient } from "@/lib/supabase/server";
import { getUserIdFromBearer } from "@/lib/supabase/route-user";
import {
  resolveTransactionPaymentMethod,
  resolveTransactionReceiptUrl,
} from "@/lib/payments/transaction-detail";
import { resolveServiceDisplayName } from "@/lib/service-id";
import { NextRequest, NextResponse } from "next/server";

type RouteContext = { params: Promise<{ id: string }> };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
    const isEn = language === "en";

    const { data: lock, error } = await supabase
      .from("booking_price_locks")
      .select(
        "id, order_id, service_id, customer_id, payment_captured_at, payment_authorized_at, locked_at, delivery_fee, customer_total, customer_service_price, addons_customer_total, payment_captured_amount, payment_authorized_amount, currency, stripe_payment_intent_id",
      )
      .eq("id", transactionId)
      .eq("customer_id", userId)
      .maybeSingle();

    if (error) throw error;
    if (!lock) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    const stripeReceipt = await resolveTransactionReceiptUrl(
      lock.stripe_payment_intent_id,
    );
    if (stripeReceipt && req.nextUrl.searchParams.get("prefer_stripe") === "1") {
      return NextResponse.redirect(stripeReceipt);
    }

    const [serviceName, paymentMethod] = await Promise.all([
      resolveServiceDisplayName(supabase, lock.service_id),
      resolveTransactionPaymentMethod(lock.stripe_payment_intent_id),
    ]);

    const whenIso =
      lock.payment_captured_at ||
      lock.payment_authorized_at ||
      lock.locked_at;
    const when = whenIso ? new Date(whenIso) : null;
    const whenLabel =
      when && !Number.isNaN(when.getTime())
        ? when.toLocaleString(isEn ? "en-GB" : "nb-NO")
        : "—";
    const total = Math.round(Number(lock.customer_total) || 0);
    const deliveryFee = Math.round(Number(lock.delivery_fee) || 0);
    const servicePrice = Math.round(Number(lock.customer_service_price) || 0);
    const addonsTotal = Math.round(Number(lock.addons_customer_total) || 0);
    const invoiceRef = lock.order_id
      ? String(lock.order_id).slice(0, 8).toUpperCase()
      : String(lock.id).slice(0, 8).toUpperCase();

    const html = `<!DOCTYPE html>
<html lang="${isEn ? "en" : "no"}">
<head>
  <meta charset="utf-8" />
  <title>${isEn ? "Invoice" : "Faktura"} ${escapeHtml(invoiceRef)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 2rem auto; color: #111; }
    h1 { font-size: 1.25rem; margin-bottom: 0.25rem; }
    .muted { color: #666; font-size: 0.875rem; }
    table { width: 100%; border-collapse: collapse; margin-top: 1.5rem; }
    td { padding: 0.5rem 0; border-bottom: 1px solid #eee; }
    td:last-child { text-align: right; font-weight: 600; }
    .total td { border-top: 2px solid #111; border-bottom: none; font-size: 1.1rem; }
  </style>
</head>
<body>
  <h1>FreshUp</h1>
  <p class="muted">${isEn ? "Invoice" : "Faktura"} · ${escapeHtml(invoiceRef)}</p>
  <p class="muted">${escapeHtml(whenLabel)}</p>
  <p><strong>${escapeHtml(serviceName)}</strong></p>
  <table>
    <tr><td>${isEn ? "Service" : "Tjeneste"}</td><td>${servicePrice} ${String(lock.currency || "NOK").toUpperCase()}</td></tr>
    ${addonsTotal > 0 ? `<tr><td>${isEn ? "Add-ons" : "Tillegg"}</td><td>${addonsTotal} ${String(lock.currency || "NOK").toUpperCase()}</td></tr>` : ""}
    ${deliveryFee > 0 ? `<tr><td>${isEn ? "Delivery fee" : "Delivery-tillegg"}</td><td>${deliveryFee} ${String(lock.currency || "NOK").toUpperCase()}</td></tr>` : ""}
    <tr class="total"><td>${isEn ? "Total" : "Totalt"}</td><td>${total} ${String(lock.currency || "NOK").toUpperCase()}</td></tr>
  </table>
  ${paymentMethod ? `<p class="muted" style="margin-top:1.5rem">${isEn ? "Payment method" : "Betalingsmetode"}: ${escapeHtml(paymentMethod)}</p>` : ""}
  ${stripeReceipt ? `<p class="muted"><a href="${escapeHtml(stripeReceipt)}">${isEn ? "Stripe receipt" : "Stripe-kvittering"}</a></p>` : ""}
</body>
</html>`;

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="freshup-invoice-${invoiceRef}.html"`,
      },
    });
  } catch (error) {
    console.error("[payments/history/[id]/invoice]", error);
    return NextResponse.json(
      { error: "Failed to generate invoice" },
      { status: 500 },
    );
  }
}
