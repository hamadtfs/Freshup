// =====================================================
// Fresh Up - Book Service API Route
// =====================================================
// POST /api/orders/book
// Creates a new service request and finds matching providers

import { createAdminClient } from "@/lib/supabase/server";
import { getUserIdFromBearer } from "@/lib/supabase/route-user";
import { resolveCanonicalService } from "@/lib/service-id";
import { dispatchTick } from "@/lib/orders/dispatchTick";
import { refreshDemandZoneAt } from "@/lib/pricing/used-capacity";
import {
  DISPATCH_LAST_WAVE_DELAY_MS,
  DISPATCH_PROVIDER_OFFER_TTL_MS,
} from "@/lib/orders/dispatchTiming";
import { assertBookingPaymentAuthorized } from "@/lib/payments/order-payment";
import { isStripeConfigured } from "@/lib/payments/stripe";
import type { BookOrderRequestBody } from "@/lib/customer/types";
import {
  parseAddonSelections,
  resolveOrderAddonIds,
} from "@/lib/orders/resolve-order-addons";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient();

    const userId = await getUserIdFromBearer(supabase, req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse request body
    const body = (await req.json()) as BookOrderRequestBody;

    // Validate required fields
    if (!body.service_id || !body.delivery_mode) {
      return NextResponse.json(
        { error: "service_id and delivery_mode are required" },
        { status: 400 },
      );
    }

    // For home delivery, location is required
    if (
      body.delivery_mode === "home" &&
      (!body.customer_lat || !body.customer_lng)
    ) {
      return NextResponse.json(
        { error: "Location required for home delivery" },
        { status: 400 },
      );
    }

    // Resolve canonical service id so both beard_dye and beard-dye work.
    const service = await resolveCanonicalService<any>(
      supabase,
      body.service_id,
      "*",
    );
    if (!service) {
      return NextResponse.json({ error: "Service not found" }, { status: 404 });
    }
    const canonicalServiceId = String(service.id);

    if (
      (body.mode_id && body.mode_id !== service.mode_id) ||
      (body.target_id && body.target_id !== service.target_id) ||
      (body.category_id && body.category_id !== service.category_id)
    ) {
      return NextResponse.json(
        {
          error:
            "Hierarchy mismatch: selected service does not belong to provided mode/target/category",
        },
        { status: 400 },
      );
    }

    if (
      body.service_mode_id &&
      body.service_mode_id !== "both" &&
      service.service_mode_id &&
      service.service_mode_id !== "both" &&
      body.service_mode_id !== service.service_mode_id
    ) {
      return NextResponse.json(
        {
          error:
            "Service mode mismatch: selected service does not support provided service_mode_id",
        },
        { status: 400 },
      );
    }

    const requestedServiceMode =
      body.delivery_mode === "home" ? "home" : "provider";
    if (
      body.service_mode_id &&
      body.service_mode_id !== "both" &&
      body.service_mode_id !== requestedServiceMode
    ) {
      return NextResponse.json(
        {
          error:
            "service_mode_id must be compatible with delivery_mode (home/provider)",
        },
        { status: 400 },
      );
    }

    if (body.addon_ids != null && !Array.isArray(body.addon_ids)) {
      return NextResponse.json(
        { error: "addon_ids must be an array of IDs" },
        { status: 400 },
      );
    }

    const addonSelections = parseAddonSelections(body);
    let addonIds = Array.isArray(body.addon_ids)
      ? [
          ...new Set(
            body.addon_ids.filter(
              (id) => typeof id === "string" && id.trim() !== "",
            ),
          ),
        ]
      : [];

    if (addonSelections.length > 0) {
      try {
        addonIds = await resolveOrderAddonIds(
          supabase,
          canonicalServiceId,
          addonSelections,
        );
      } catch (resolveErr) {
        console.error("[book] resolve addons:", resolveErr);
        return NextResponse.json(
          { error: "Failed to resolve add-ons" },
          { status: 500 },
        );
      }
    }

    let addonsTotal = 0;
    if (addonIds.length > 0) {
      const { data: addons, error: addonsErr } = await supabase
        .from("service_addons")
        .select("id, extra_price")
        .eq("service_id", canonicalServiceId)
        .eq("is_active", true)
        .in("id", addonIds);

      if (addonsErr) {
        console.error("[v0] Add-on validation error:", addonsErr);
        return NextResponse.json(
          { error: "Failed to validate add-ons" },
          { status: 500 },
        );
      }

      if ((addons ?? []).length !== addonIds.length) {
        return NextResponse.json(
          { error: "One or more add-ons are invalid for this service" },
          { status: 400 },
        );
      }

      addonsTotal = (addons ?? []).reduce(
        (sum, addon) => sum + (Number(addon.extra_price) || 0),
        0,
      );
    }

    // ------------------------------------------------------------------
    // Pricing — spec §2.2 / §2.3 "lock displayed price during booking flow"
    // ------------------------------------------------------------------
    // Three-tier strategy (in order of precedence):
    //   1. price_lock_id  → copy price from booking_price_locks (post-migration flow)
    //   2. Pricing engine → buildQuote() with current dynamic multiplier
    //   3. Legacy fallback → (services.base_price_min + base_price_max) / 2
    // Tiers 2 & 3 keep the existing flow alive when a lock isn't supplied.
    let basePrice = 0;
    let totalPrice = 0;
    let priceLockRow: any = null;

    const lockId =
      typeof (body as any)?.price_lock_id === "string" &&
      (body as any).price_lock_id.trim() !== ""
        ? (body as any).price_lock_id.trim()
        : null;

    if (lockId) {
      const { data: lock, error: lockErr } = await supabase
        .from("booking_price_locks")
        .select("*")
        .eq("id", lockId)
        .eq("customer_id", userId)
        .maybeSingle();

      if (lockErr) {
        console.error("[v0] booking_price_locks read error:", lockErr);
      }
      if (!lock) {
        return NextResponse.json(
          {
            error: "PRICE_LOCK_NOT_FOUND",
            message: "Provided price_lock_id is invalid or not yours.",
          },
          { status: 422 },
        );
      }
      const expiresAt = new Date((lock as any).expires_at).getTime();
      if (Number.isFinite(expiresAt) && expiresAt < Date.now()) {
        return NextResponse.json(
          {
            error: "PRICE_LOCK_EXPIRED",
            message: "Price lock has expired. Please re-quote.",
          },
          { status: 410 },
        );
      }
      if ((lock as any).consumed_at != null) {
        return NextResponse.json(
          {
            error: "PRICE_LOCK_CONSUMED",
            message: "This price lock was already used.",
          },
          { status: 409 },
        );
      }
      // Lock must reference the same service the customer is booking.
      const lockServiceId = String((lock as any).service_id || "");
      if (lockServiceId && lockServiceId !== canonicalServiceId) {
        return NextResponse.json(
          {
            error: "PRICE_LOCK_MISMATCH",
            message: "Price lock is for a different service.",
          },
          { status: 422 },
        );
      }
      priceLockRow = lock;
      basePrice = Number((lock as any).customer_service_price) || 0;
      totalPrice = Number((lock as any).customer_total) || 0;

      if (isStripeConfigured()) {
        try {
          await assertBookingPaymentAuthorized(supabase, lockId, userId);
        } catch (payErr) {
          const message =
            payErr instanceof Error ? payErr.message : "PAYMENT_NOT_AUTHORIZED";
          return NextResponse.json(
            {
              error: "PAYMENT_NOT_AUTHORIZED",
              message:
                "Complete payment authorization before searching for a provider.",
              detail: message,
            },
            { status: 402 },
          );
        }
      }
    }

    if (totalPrice <= 0) {
      // Tier 2: try the live pricing engine. Safe to import here so build
      // doesn't pull it into routes that don't use it.
      try {
        const { buildQuote } = await import("@/lib/pricing/server");
        const deliveryKm =
          body.delivery_mode === "home" &&
          typeof body.delivery_km === "number" &&
          Number.isFinite(body.delivery_km) &&
          body.delivery_km >= 0
            ? body.delivery_km
            : null;
        const quote = await buildQuote(supabase, {
          serviceId: canonicalServiceId,
          customerLat: body.customer_lat ?? null,
          customerLng: body.customer_lng ?? null,
          deliveryMode: body.delivery_mode === "home" ? "home" : "provider",
          deliveryKm,
          addonIds,
        });
        if (quote && quote.customerTotal > 0) {
          basePrice = quote.customerServicePrice;
          totalPrice = quote.customerTotal;
        }
      } catch (engineErr) {
        console.error("[v0] Pricing engine fallback failed:", engineErr);
      }
    }

    if (totalPrice <= 0) {
      // Tier 3: legacy services.base_price_* — preserves pre-migration behaviour.
      const baseMin = Number(service.base_price_min);
      const baseMax = Number(service.base_price_max);
      if (
        Number.isFinite(baseMin) &&
        baseMin > 0 &&
        Number.isFinite(baseMax) &&
        baseMax > 0
      ) {
        basePrice = Math.round((baseMin + baseMax) / 2);
      } else if (Number.isFinite(baseMin) && baseMin > 0) {
        basePrice = baseMin;
      } else if (Number.isFinite(baseMax) && baseMax > 0) {
        basePrice = baseMax;
      }
      totalPrice = basePrice + addonsTotal;
      if (body.delivery_mode === "home") {
        const { computeDeliveryFee } = await import("@/lib/pricing");
        const deliveryKm =
          typeof body.delivery_km === "number" &&
          Number.isFinite(body.delivery_km) &&
          body.delivery_km >= 0
            ? body.delivery_km
            : 0;
        totalPrice += computeDeliveryFee(deliveryKm, true);
      }
    }

    const orderPriceKr = Math.round(totalPrice);
    const orderServicePriceKr = Math.round(basePrice);

    // Create the order
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        customer_id: userId,
        service_id: canonicalServiceId,
        delivery_mode: body.delivery_mode,
        customer_lat: body.customer_lat,
        customer_lng: body.customer_lng,
        customer_address: body.customer_address,
        scheduled_at: body.scheduled_at || null,
        notes: body.notes,
        status: "pending",
        price: orderPriceKr,
        currency: "NOK",
        dispatch_wave_index: -1,
        dispatch_wave_started_at: null,
      })
      .select()
      .single();

    if (orderError) {
      console.error("[v0] Order creation error:", orderError);
      return NextResponse.json(
        { error: "Failed to create order" },
        { status: 500 },
      );
    }

    if (
      typeof body.customer_lat === "number" &&
      Number.isFinite(body.customer_lat) &&
      typeof body.customer_lng === "number" &&
      Number.isFinite(body.customer_lng)
    ) {
      void refreshDemandZoneAt(
        supabase,
        canonicalServiceId,
        body.customer_lat,
        body.customer_lng,
      ).catch((err) =>
        console.error("[v0] demand zone refresh after book:", err),
      );
    }

    // Use the DB-created timestamp for dispatch timing. Local/dev app clocks can
    // drift from the database clock, which otherwise makes offers expire before
    // providers can see them.
    const dispatchStartedAt = new Date(
      String(order.created_at || new Date().toISOString()),
    );
    const dispatchDeadlineAt = new Date(
      dispatchStartedAt.getTime() +
        DISPATCH_LAST_WAVE_DELAY_MS +
        DISPATCH_PROVIDER_OFFER_TTL_MS,
    );
    await supabase
      .from("orders")
      .update({
        dispatch_started_at: dispatchStartedAt.toISOString(),
        dispatch_deadline_at: dispatchDeadlineAt.toISOString(),
      })
      .eq("id", order.id);

    if (addonIds.length > 0) {
      const { data: addons } = await supabase
        .from("service_addons")
        .select("id, extra_price")
        .eq("service_id", canonicalServiceId)
        .eq("is_active", true)
        .in("id", addonIds);

      const addonRows =
        addons?.map((addon) => ({
          order_id: order.id,
          addon_id: addon.id,
          unit_price: Math.round(Number(addon.extra_price) || 0),
          quantity: 1,
        })) ?? [];

      if (addonRows.length > 0) {
        const { error: orderAddonsError } = await supabase
          .from("order_addons")
          .insert(addonRows);
        if (orderAddonsError) {
          console.error("[v0] Order add-ons snapshot error:", orderAddonsError);
          return NextResponse.json(
            { error: "Failed to persist order add-ons" },
            { status: 500 },
          );
        }
      }
    }

    // Mark the price lock consumed so it can't be re-used. Failure here is
    // non-fatal — the order has already been created with the locked price.
    if (priceLockRow) {
      const { error: consumeErr } = await supabase
        .from("booking_price_locks")
        .update({ consumed_at: new Date().toISOString(), order_id: order.id })
        .eq("id", priceLockRow.id);
      if (consumeErr) {
        console.error("[v0] booking_price_locks consume error:", consumeErr);
      }
    }

    // Wave 0 = Batch 1 (0–3 km, 5★) · Gold at t=0 — must not wait for cron.
    try {
      const tickResult = await dispatchTick(supabase as any, {
        onlyOrderId: order.id,
        limit: 1,
        immediateThroughStep: 0,
      });
      const firstWave = tickResult.results?.[0];
      if (
        firstWave?.action === "waiting_next_wave" ||
        firstWave?.action === "skipped_locked"
      ) {
        console.error("[book] First dispatch wave did not run:", firstWave);
      }
    } catch (e) {
      console.error("[book] Immediate dispatchTick failed:", e);
    }

    return NextResponse.json({
      success: true,
      order_id: order.id,
      service: {
        id: service.id,
        name: service.name,
        duration_minutes: service.duration_minutes,
        base_price: orderServicePriceKr,
        total_price: orderPriceKr,
      },
      dispatch: {
        started_at: dispatchStartedAt.toISOString(),
        deadline_at: dispatchDeadlineAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("[v0] Booking error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
