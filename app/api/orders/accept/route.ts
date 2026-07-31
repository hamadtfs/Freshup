import { computeDeliveryFee } from "@/lib/pricing";
import {
  homeOrderCustomerTotal,
  resolveCustomerServicePrice,
} from "@/lib/pricing/home-order-total";
import { captureOrderPaymentAtMatch } from "@/lib/payments/order-payment";
import {
  resolveAddonsCustomerTotal,
  sumOrderAddonsCustomerTotal,
} from "@/lib/payments/order-addon-totals";
import { createAdminClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient();
    const body = (await req.json()) as {
      offer_id?: string;
      provider_id?: string;
      /** When the provider first saw the hydrated offer sheet (UI timer start). */
      offer_shown_at?: string | null;
    };
    const offer_id = body.offer_id;
    const provider_id = body.provider_id;
    const offerShownAtRaw = body.offer_shown_at;

    if (!offer_id || !provider_id) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    // Get the offer
    const { data: offer, error: offerError } = await supabase
      .from("order_offers")
      .select("*")
      .eq("id", offer_id)
      .single();

    if (offerError || !offer) {
      return NextResponse.json({ error: "Offer not found" }, { status: 404 });
    }

    if (String(offer.provider_id) !== String(provider_id)) {
      return NextResponse.json(
        { error: "Offer does not belong to provider" },
        { status: 403 },
      );
    }

    // Server-side grace window for the inevitable race between the 9s
    // offer TTL and the 9s dispatch tick (or network/UI latency between
    // user click and request landing). If the order is still unassigned
    // and we are within ACCEPT_GRACE_MS past expires_at, allow the claim.
    const ACCEPT_GRACE_MS = 3_000;
    const offerExpiresMs = new Date(offer.expires_at).getTime();
    const beyondGrace =
      Number.isFinite(offerExpiresMs) &&
      Date.now() > offerExpiresMs + ACCEPT_GRACE_MS;

    if (offer.status !== "pending") {
      // If the offer was auto-expired by dispatch_tick but the order is still
      // unassigned and we are within grace, treat the click as still valid.
      if (offer.status === "expired" && !beyondGrace) {
        const { data: orderStillOpen } = await supabase
          .from("orders")
          .select("id, provider_id, status")
          .eq("id", offer.order_id)
          .is("provider_id", null)
          .in("status", ["pending", "offered"])
          .maybeSingle();
        if (!orderStillOpen) {
          return NextResponse.json(
            { error: "Offer already responded to" },
            { status: 400 },
          );
        }
        // Reactivate this offer so the claim path below (status check on
        // order, not offer) works without changing the order claim semantics.
        // We don't trust an "expired" offer to win without an open order.
      } else {
        return NextResponse.json(
          { error: "Offer already responded to" },
          { status: 400 },
        );
      }
    }

    // Hard expiry past grace: stop here.
    if (beyondGrace) {
      await supabase
        .from("order_offers")
        .update({ status: "expired" })
        .eq("id", offer_id)
        .eq("status", "pending");

      return NextResponse.json({ error: "Offer has expired" }, { status: 400 });
    }

    // First-wins claim on the order row.
    // Only one provider can set provider_id while it's still unassigned.
    const { data: claimedOrderRows, error: claimError } = await supabase
      .from("orders")
      .update({
        status: "assigned",
        provider_id: provider_id,
        accepted_at: new Date().toISOString(),
      })
      .eq("id", offer.order_id)
      .is("provider_id", null)
      // DB enum `order_status` does not include "searching" (see remote_schema).
      .in("status", ["pending", "offered"])
      .select("id");

    if (claimError) throw claimError;
    if (!claimedOrderRows || claimedOrderRows.length === 0) {
      await supabase
        .from("order_offers")
        .update({ status: "declined", responded_at: new Date().toISOString() })
        .eq("id", offer_id);
      return NextResponse.json(
        { error: "Order already accepted by another provider" },
        { status: 409 },
      );
    }

    // Decline all other offers for this order
    await supabase
      .from("order_offers")
      .update({ status: "declined" })
      .eq("order_id", offer.order_id)
      .neq("id", offer_id);

    // Mark winner offer as accepted.
    // Score response speed from when the provider *saw* the sheet (offer_shown_at),
    // not dispatch created_at — push/hydrate delay often eats 10–40s before UI.
    const respondedAt = new Date();
    const createdMs = new Date(String(offer.created_at || "")).getTime();
    const shownMs = offerShownAtRaw
      ? new Date(String(offerShownAtRaw)).getTime()
      : NaN;
    const startMs =
      Number.isFinite(shownMs) &&
      Number.isFinite(createdMs) &&
      shownMs >= createdMs - 2_000 &&
      shownMs <= respondedAt.getTime()
        ? shownMs
        : Number.isFinite(createdMs)
          ? createdMs
          : respondedAt.getTime();
    const responseTimeSeconds = Math.max(
      0,
      Math.round(((respondedAt.getTime() - startMs) / 1000) * 1000) / 1000,
    );

    const { error: acceptError } = await supabase
      .from("order_offers")
      .update({
        status: "accepted",
        responded_at: respondedAt.toISOString(),
        response_time_seconds: responseTimeSeconds,
      })
      .eq("id", offer_id);
    if (acceptError) throw acceptError;

    // Log event
    await supabase.from("order_events").insert([
      {
        order_id: offer.order_id,
        event_type: "order_accepted",
        actor_id: provider_id,
      },
    ]);

    // Home delivery: keep locked service price, update total for provider distance.
    const providerDistanceKm = Number(offer.provider_distance_km);
    if (Number.isFinite(providerDistanceKm) && providerDistanceKm >= 0) {
      const [{ data: orderRow }, { data: priceLock }] = await Promise.all([
        supabase
          .from("orders")
          .select("price, delivery_mode")
          .eq("id", offer.order_id)
          .maybeSingle(),
        supabase
          .from("booking_price_locks")
          .select(
            "customer_service_price, delivery_fee, addons_customer_total, customer_total",
          )
          .eq("order_id", offer.order_id)
          .maybeSingle(),
      ]);

      if (orderRow?.delivery_mode === "home" && priceLock) {
        const orderAddonsCustomerTotal = await sumOrderAddonsCustomerTotal(
          supabase,
          offer.order_id,
        );
        const addonsCustomerTotal = resolveAddonsCustomerTotal(
          (priceLock as { addons_customer_total?: number })
            .addons_customer_total,
          orderAddonsCustomerTotal,
        );
        const enrichedLock = {
          ...priceLock,
          addons_customer_total: addonsCustomerTotal,
        };
        const distanceForPricing =
          Number.isFinite(providerDistanceKm) && providerDistanceKm >= 0
            ? providerDistanceKm
            : 0;
        const adjustedTotal = homeOrderCustomerTotal(
          enrichedLock,
          Number(orderRow.price) || 0,
          distanceForPricing,
        );
        if (adjustedTotal > 0) {
          const adjustedDelivery = computeDeliveryFee(distanceForPricing, true);
          const lockedService = resolveCustomerServicePrice(
            enrichedLock,
            Number(orderRow.price) || 0,
          );
          await supabase
            .from("orders")
            .update({ price: adjustedTotal })
            .eq("id", offer.order_id);
          await supabase
            .from("booking_price_locks")
            .update({
              ...(lockedService > 0
                ? { customer_service_price: lockedService }
                : {}),
              ...(addonsCustomerTotal > 0
                ? { addons_customer_total: addonsCustomerTotal }
                : {}),
              delivery_km: distanceForPricing,
              delivery_fee: adjustedDelivery,
              customer_total: adjustedTotal,
            })
            .eq("order_id", offer.order_id);
        }
      }
    }

    const captureResult = await captureOrderPaymentAtMatch(
      supabase,
      offer.order_id,
      Number.isFinite(providerDistanceKm) && providerDistanceKm >= 0
        ? providerDistanceKm
        : null,
    );

    try {
      const { data: orderForPush } = await supabase
        .from("orders")
        .select("customer_id")
        .eq("id", offer.order_id)
        .maybeSingle();
      const customerId = orderForPush?.customer_id
        ? String(orderForPush.customer_id)
        : "";
      if (customerId) {
        void import("@/lib/notifications/expo-push").then(({ notifyUsers }) =>
          notifyUsers({
            userIds: [customerId],
            title: "Provider matched",
            body: "A provider accepted your booking.",
            data: {
              type: "order_assigned",
              order_id: offer.order_id,
            },
          }),
        );
      }
    } catch (e) {
      console.error("[accept] push notify", e);
    }

    return NextResponse.json({
      success: true,
      order_id: offer.order_id,
      payment: captureResult.captured
        ? {
            captured: true,
            charged_amount_kr: captureResult.amountKr,
          }
        : {
            captured: false,
            error: captureResult.error ?? null,
          },
    });
  } catch (error) {
    console.error("[v0] Accept order error:", error);
    return NextResponse.json(
      { error: "Failed to accept order" },
      { status: 500 },
    );
  }
}
