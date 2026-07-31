// =====================================================================
// FreshUp Pricing — customer-facing quote (spec §2.2 – §2.5)
// GET /api/pricing/quote
//
// Returns a fresh price breakdown for ONE service, in ONE area, at the
// current dynamic-pricing multiplier. The endpoint is intentionally
// read-only and side-effect free — to *lock* a price for a customer
// (spec §2.3 "lock the displayed price") use POST /api/pricing/lock.
//
// Query parameters:
//   service_id      (required) e.g. "classic_cut_m"
//   lat, lng        (optional) customer GPS — used to resolve the area
//   delivery_mode   (optional) "home" | "provider" (default: "provider")
//   km              (optional) customer↔provider distance in km
//   addon_ids       (optional) comma-separated list of service_addons.id
// =====================================================================

import { createAdminClient } from "@/lib/supabase/server";
import { buildQuote } from "@/lib/pricing/server";
import { DEFAULT_SEARCH_DELIVERY_KM } from "@/lib/pricing/interim-delivery-km";
import { NextRequest, NextResponse } from "next/server";

function parseNumber(value: string | null): number | null {
  if (value == null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const serviceId = params.get("service_id");
    if (!serviceId) {
      return NextResponse.json(
        { error: "service_id is required" },
        { status: 400 },
      );
    }

    const customerLat = parseNumber(params.get("lat"));
    const customerLng = parseNumber(params.get("lng"));
    const km = parseNumber(params.get("km"));
    const deliveryModeRaw = params.get("delivery_mode");
    const deliveryMode: "home" | "provider" =
      deliveryModeRaw === "home" ? "home" : "provider";

    const addonIdsRaw = params.get("addon_ids") ?? "";
    const addonIds = addonIdsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const supabase = createAdminClient();

    const quote = await buildQuote(supabase, {
      serviceId,
      customerLat,
      customerLng,
      // For the public service-card view we don't yet know which provider
      // will be assigned — pass km directly via the `delivery_km` channel.
      providerLat: null,
      providerLng: null,
      deliveryMode,
      addonIds,
      preferLiveCapacity:
        customerLat != null && customerLng != null,
    });

    if (!quote) {
      return NextResponse.json(
        {
          error: "PRICE_UNAVAILABLE",
          message:
            "No active base price for this service in your area, and no fallback configured.",
        },
        { status: 422 },
      );
    }

    if (deliveryMode === "home") {
      const { computeDeliveryFee } = await import("@/lib/pricing");
      const resolvedKm =
        km != null && km > 0 ? km : DEFAULT_SEARCH_DELIVERY_KM;
      const correctedDelivery = computeDeliveryFee(resolvedKm, true);
      const deliveryDelta = correctedDelivery - quote.deliveryFee;
      quote.deliveryFee = correctedDelivery;
      quote.customerTotal = round2(quote.customerTotal + deliveryDelta);
      quote.providerTotal = round2(quote.providerTotal + deliveryDelta);
    }

    return NextResponse.json(quote);
  } catch (error) {
    console.error("[pricing] quote error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
