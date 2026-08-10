// =====================================================================
// FreshUp Pricing — booking price lock (spec §2.3)
// POST /api/pricing/lock
//
// Spec §2.3:
//   "Once a customer starts a booking, lock the displayed price so it
//    doesn't change mid-flow."
//
// The flow is:
//   1. Customer browses → service card displays the live quote.
//   2. Customer clicks "Book" → frontend POSTs here with the same
//      parameters used by /api/pricing/quote.
//   3. We re-compute the quote server-side (don't trust the UI) and
//      persist a row in booking_price_locks. The expiry is 15 minutes
//      (PRICE_LOCK_TTL_MINUTES) — enough for any normal booking flow.
//   4. POST /api/orders/book consumes the lock, copies its prices into
//      the order row, and stamps consumed_at.
//
// GET /api/pricing/lock?id=… returns an existing lock (for resuming a
// partially completed booking flow without recomputing).
// =====================================================================

import { createAdminClient } from "@/lib/supabase/server";
import { getUserIdFromBearer } from "@/lib/supabase/route-user";
import { buildQuote } from "@/lib/pricing/server";
import { DEFAULT_SEARCH_DELIVERY_KM } from "@/lib/pricing/interim-delivery-km";
import { computeDeliveryFee, DEFAULT_CURRENCY, PRICE_LOCK_TTL_MINUTES } from "@/lib/pricing";
import {
  parseAddonSelections,
  resolveOrderAddonIds,
} from "@/lib/orders/resolve-order-addons";
import { resolveCanonicalService } from "@/lib/service-id";
import { NextRequest, NextResponse } from "next/server";

interface LockRequestBody {
  service_id: string;
  delivery_mode?: "home" | "provider";
  customer_lat?: number;
  customer_lng?: number;
  delivery_km?: number;
  addon_ids?: string[];
  addon_selections?: {
    catalog_id: string;
    name: string;
    price: number;
    extra_minutes?: number;
  }[];
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient();

    const customerId = await getUserIdFromBearer(supabase, req);
    if (!customerId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as LockRequestBody;
    if (!body?.service_id) {
      return NextResponse.json(
        { error: "service_id is required" },
        { status: 400 },
      );
    }

    const deliveryMode: "home" | "provider" =
      body.delivery_mode === "home" ? "home" : "provider";

    if (
      deliveryMode === "home" &&
      (typeof body.customer_lat !== "number" ||
        typeof body.customer_lng !== "number")
    ) {
      return NextResponse.json(
        { error: "customer_lat and customer_lng are required for home delivery" },
        { status: 400 },
      );
    }

    let addonIds = Array.isArray(body.addon_ids)
      ? body.addon_ids.filter((id) => typeof id === "string" && id.trim() !== "")
      : [];

    const addonSelections = parseAddonSelections(body);
    if (addonSelections.length > 0) {
      const service = await resolveCanonicalService(supabase, body.service_id, "id");
      if (!service?.id) {
        return NextResponse.json({ error: "Service not found" }, { status: 404 });
      }
      try {
        addonIds = await resolveOrderAddonIds(
          supabase,
          String(service.id),
          addonSelections,
        );
      } catch (resolveErr) {
        console.error("[pricing/lock] resolve addons:", resolveErr);
        return NextResponse.json(
          { error: "Failed to resolve add-ons" },
          { status: 500 },
        );
      }
    }

    const quote = await buildQuote(supabase, {
      serviceId: body.service_id,
      customerLat: body.customer_lat ?? null,
      customerLng: body.customer_lng ?? null,
      deliveryMode,
      addonIds,
      preferLiveCapacity: true,
    });

    if (!quote) {
      return NextResponse.json(
        {
          error: "PRICE_UNAVAILABLE",
          message: "No active base price for this service in your area.",
        },
        { status: 422 },
      );
    }

    if (quote.marketClosed) {
      return NextResponse.json(
        {
          error: "MARKET_CLOSED",
          message: "No providers available right now for this service nearby.",
          market_closed: true,
          online_providers_nearby: quote.onlineProvidersNearby,
        },
        { status: 422 },
      );
    }

    // Pre-match booking: 1 km default (160 kr min fee) until a provider is assigned.
    // Real driving km is applied on the matched provider offer, not at lock time.
    let deliveryKm: number | null = null;
    if (deliveryMode === "home") {
      deliveryKm = DEFAULT_SEARCH_DELIVERY_KM;
      const corrected = computeDeliveryFee(DEFAULT_SEARCH_DELIVERY_KM, true);
      const delta = corrected - quote.deliveryFee;
      quote.deliveryFee = corrected;
      quote.customerTotal = round2(quote.customerTotal + delta);
      quote.providerTotal = round2(quote.providerTotal + delta);
    }

    const expiresAt = new Date(
      Date.now() + PRICE_LOCK_TTL_MINUTES * 60 * 1000,
    ).toISOString();

    const { data: lock, error: lockErr } = await supabase
      .from("booking_price_locks")
      .insert({
        customer_id: customerId,
        service_id: quote.serviceId,
        area_id: quote.areaId === "unknown" ? null : quote.areaId,
        delivery_mode: deliveryMode,
        delivery_km: deliveryKm,
        addon_ids: addonIds,
        base_price: quote.providerBasePrice,
        multiplier: quote.multiplier,
        used_capacity_pct: quote.usedCapacityPct,
        provider_service_price: quote.providerServicePrice,
        customer_service_price: quote.customerServicePrice,
        delivery_fee: quote.deliveryFee,
        addons_customer_total: quote.addonsCustomerTotal,
        addons_provider_total: quote.addonsProviderTotal,
        customer_total: quote.customerTotal,
        provider_total: quote.providerTotal,
        freshup_total: quote.freshupTotal,
        currency: DEFAULT_CURRENCY,
        expires_at: expiresAt,
      })
      .select(
        "id, customer_total, provider_total, freshup_total, currency, expires_at, locked_at",
      )
      .single();

    if (lockErr || !lock) {
      console.error("[pricing] booking_price_locks insert error:", lockErr);
      return NextResponse.json(
        { error: "Failed to lock price" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      lock_id: (lock as any).id,
      expires_at: (lock as any).expires_at,
      locked_at: (lock as any).locked_at,
      currency: (lock as any).currency,
      breakdown: {
        ...quote,
        deliveryKm: deliveryKm ?? undefined,
      },
    });
  } catch (error) {
    console.error("[pricing] lock POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient();

    const customerId = await getUserIdFromBearer(supabase, req);
    if (!customerId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("booking_price_locks")
      .select("*")
      .eq("id", id)
      .eq("customer_id", customerId)
      .maybeSingle();
    if (error) {
      console.error("[pricing] lock GET error:", error);
      return NextResponse.json(
        { error: "Failed to read lock" },
        { status: 500 },
      );
    }
    if (!data) {
      return NextResponse.json({ error: "Lock not found" }, { status: 404 });
    }

    const now = Date.now();
    const expiresAt = new Date((data as any).expires_at).getTime();
    const isExpired = Number.isFinite(expiresAt) && expiresAt < now;
    const isConsumed = (data as any).consumed_at != null;

    return NextResponse.json({
      lock: data,
      is_expired: isExpired,
      is_consumed: isConsumed,
    });
  } catch (error) {
    console.error("[pricing] lock GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
