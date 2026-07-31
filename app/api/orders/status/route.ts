import { computeDeliveryFee } from "@/lib/pricing";
import {
  homeOrderCustomerTotal,
  resolveCustomerServicePrice,
} from "@/lib/pricing/home-order-total";
import {
  resolveAddonsCustomerTotal,
  sumOrderAddonsCustomerTotal,
} from "@/lib/payments/order-addon-totals";
import { createAdminClient } from "@/lib/supabase/server";
import { getUserIdFromBearer } from "@/lib/supabase/route-user";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient();
    const userId = await getUserIdFromBearer(supabase, req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const orderId = String(searchParams.get("order_id") || "").trim();
    if (!orderId) {
      return NextResponse.json(
        { error: "order_id is required" },
        { status: 400 },
      );
    }

    const baseSelect =
      "id, customer_id, provider_id, status, accepted_at, started_at, service_id, dispatch_wave_index, dispatch_deadline_at, price, delivery_mode";
    let orderResult = await supabase
      .from("orders")
      .select(
        `${baseSelect}, service_paused_at, service_paused_total_seconds`,
      )
      .eq("id", orderId)
      .maybeSingle();
    if (
      orderResult.error &&
      typeof orderResult.error.message === "string" &&
      /column .* does not exist/i.test(orderResult.error.message)
    ) {
      orderResult = await supabase
        .from("orders")
        .select(baseSelect)
        .eq("id", orderId)
        .maybeSingle();
    }
    const { data: order, error: orderErr } = orderResult;
    if (orderErr) throw orderErr;
    if (!order || String(order.customer_id) !== userId) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    let serviceDurationMinutes: number | null = null;
    if (order.service_id) {
      const { data: service } = await supabase
        .from("services")
        .select("duration_minutes")
        .eq("id", order.service_id)
        .maybeSingle();
      const mins = Number((service as { duration_minutes?: number } | null)?.duration_minutes);
      if (Number.isFinite(mins) && mins > 0) {
        serviceDurationMinutes = mins;
      }
    }

    let provider: {
      id: string;
      name: string;
      avatarUrl: string | null;
      phone: string | null;
      distance_km: number | null;
    } | null = null;
    if (order.provider_id) {
      const providerId = String(order.provider_id);
      const [{ data: details }, { data: profile }, { data: acceptedOffer }] =
        await Promise.all([
          supabase
            .from("provider_details")
            .select("id, business_name, avatar_url, phone")
            .eq("id", providerId)
            .maybeSingle(),
          supabase
            .from("profiles")
            .select("id, display_name, phone")
            .eq("id", providerId)
            .maybeSingle(),
          supabase
            .from("order_offers")
            .select("provider_distance_km")
            .eq("order_id", orderId)
            .eq("provider_id", providerId)
            .eq("status", "accepted")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
      const distanceKm = Number(
        (acceptedOffer as { provider_distance_km?: number } | null)
          ?.provider_distance_km,
      );
      const businessName = String((details as any)?.business_name || "").trim();
      const displayName = String((profile as any)?.display_name || "").trim();
      const avatarUrl = String((details as any)?.avatar_url || "").trim();
      const phone =
        String((details as any)?.phone || "").trim() ||
        String((profile as any)?.phone || "").trim() ||
        null;
      provider = {
        id: providerId,
        name:
          businessName ||
          displayName ||
          `Provider ${providerId.slice(0, 6)}`,
        avatarUrl: avatarUrl || null,
        phone,
        distance_km: Number.isFinite(distanceKm) ? distanceKm : null,
      };
    }

    const [{ data: priceLock }, orderAddonsCustomerTotal] = await Promise.all([
      supabase
        .from("booking_price_locks")
        .select(
          "customer_service_price, delivery_fee, addons_customer_total, customer_total, payment_captured_amount, payment_captured_at, payment_authorized_amount",
        )
        .eq("order_id", orderId)
        .maybeSingle(),
      sumOrderAddonsCustomerTotal(supabase, orderId),
    ]);

    const enrichedPriceLock = priceLock
      ? {
          ...priceLock,
          addons_customer_total: resolveAddonsCustomerTotal(
            (priceLock as { addons_customer_total?: number })
              .addons_customer_total,
            orderAddonsCustomerTotal,
          ),
        }
      : null;

    const providerDistanceKm = provider?.distance_km ?? null;
    const isHomeDelivery =
      String((order as { delivery_mode?: string }).delivery_mode || "") ===
      "home";
    const adjustedDeliveryFee =
      isHomeDelivery &&
      providerDistanceKm != null &&
      Number.isFinite(providerDistanceKm) &&
      providerDistanceKm >= 0
        ? computeDeliveryFee(providerDistanceKm, true)
        : Number((priceLock as { delivery_fee?: number } | null)?.delivery_fee) ||
          0;
    const orderPrice = Number((order as { price?: number }).price) || 0;
    const adjustedCustomerTotal = enrichedPriceLock
      ? homeOrderCustomerTotal(
          enrichedPriceLock,
          orderPrice,
          isHomeDelivery ? providerDistanceKm : null,
        )
      : 0;
    const resolvedServicePrice = enrichedPriceLock
      ? resolveCustomerServicePrice(enrichedPriceLock, orderPrice)
      : 0;

    return NextResponse.json({
      order: {
        id: order.id,
        status: order.status,
        provider_id: order.provider_id,
        accepted_at: order.accepted_at,
        started_at: (order as { started_at?: string | null }).started_at ?? null,
        service_paused_at:
          (order as { service_paused_at?: string | null }).service_paused_at ??
          null,
        service_paused_total_seconds: Number(
          (order as { service_paused_total_seconds?: number })
            .service_paused_total_seconds ?? 0,
        ),
        service_duration_minutes: serviceDurationMinutes,
        dispatch_wave_index: (order as any).dispatch_wave_index ?? null,
        dispatch_deadline_at: (order as any).dispatch_deadline_at ?? null,
        price: orderPrice,
      },
      provider,
      pricing: enrichedPriceLock
        ? {
            customer_service_price:
              resolvedServicePrice > 0
                ? resolvedServicePrice
                : Number(
                    (enrichedPriceLock as { customer_service_price?: number })
                      .customer_service_price,
                  ),
            delivery_fee: adjustedDeliveryFee,
            addons_customer_total: Number(
              (enrichedPriceLock as { addons_customer_total?: number })
                .addons_customer_total,
            ),
            customer_total:
              adjustedCustomerTotal > 0
                ? adjustedCustomerTotal
                : Number(
                    (enrichedPriceLock as { customer_total?: number })
                      .customer_total,
                  ),
          }
        : null,
      payment: enrichedPriceLock
        ? {
            authorized_amount_kr:
              Number(
                (priceLock as { payment_authorized_amount?: number })
                  .payment_authorized_amount,
              ) || null,
            charged_amount_kr:
              Number(
                (priceLock as { payment_captured_amount?: number })
                  .payment_captured_amount,
              ) || null,
            charged_at:
              (priceLock as { payment_captured_at?: string | null })
                .payment_captured_at ?? null,
          }
        : null,
    });
  } catch (error) {
    console.error("[order_status] error:", error);
    return NextResponse.json(
      { error: "Failed to fetch order status" },
      { status: 500 },
    );
  }
}
