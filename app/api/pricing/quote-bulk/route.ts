// =====================================================================
// FreshUp Pricing — bulk quote for service cards (spec §2.2 / §2.3)
// GET /api/pricing/quote-bulk?lat=&lng=&service_ids=a,b,c&delivery_mode=
//
// Returns customer-facing prices for many services in one round-trip,
// so the catalog/home page can avoid N-per-card requests.
//
// • Uses the same buildQuote() pipeline as /api/pricing/quote, so
//   prices are guaranteed consistent between this endpoint and the
//   single-service quote endpoint.
// • Always returns the FULL service set (or the filtered subset if
//   service_ids was supplied) — even when the per-service base price
//   isn't computed yet, the response includes a `fallback` flag so
//   callers can fall back to legacy `services.base_price_*` averages.
// • market_closed is evaluated per service within the 10 km match radius.
// =====================================================================

import { createAdminClient } from "@/lib/supabase/server";
import { isTransientUpstreamError, withTransientRetry } from "@/lib/supabase/transient";
import { resolveAreaIdFromDb, buildQuote } from "@/lib/pricing/server";
import { countOnlineProvidersNearbyForServices } from "@/lib/pricing/nearby-online-providers";
import { DEFAULT_CURRENCY } from "@/lib/pricing";
import { NextRequest, NextResponse } from "next/server";

const BULK_QUOTE_CONCURRENCY = 10;

function parseNumber(value: string | null): number | null {
  if (value == null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

interface BulkQuoteEntry {
  service_id: string;
  customer_service_price: number | null;
  customer_total: number | null;
  provider_service_price: number | null;
  provider_total: number | null;
  multiplier: number | null;
  used_capacity_pct: number | null;
  base_price_source: "computed" | "fallback" | "none";
  is_active: boolean;
  currency: string;
  /** Legacy fallback (`services.base_price_*` average) when no computed quote is available. */
  legacy_base_price: number | null;
  /** No live providers for this service within 10 km of the customer. */
  market_closed: boolean;
  online_providers_nearby: number;
}

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const lat = parseNumber(params.get("lat"));
    const lng = parseNumber(params.get("lng"));
    const deliveryModeRaw = params.get("delivery_mode");
    const deliveryMode: "home" | "provider" =
      deliveryModeRaw === "home" ? "home" : "provider";
    // Card prices often use delivery_mode=provider (no fee); online_mode drives
    // market_closed against providers capable of the customer's selected mode.
    const onlineModeRaw = params.get("online_mode") || deliveryModeRaw;
    const onlineMode: "home" | "provider" =
      onlineModeRaw === "home" ? "home" : "provider";

    const explicitIds = (params.get("service_ids") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const modeId = String(params.get("mode") || "").trim();

    const supabase = createAdminClient();

    // Resolve the area once for all services (saves repeated lookups inside buildQuote).
    const { areaId } = await resolveAreaIdFromDb(supabase, lat, lng);

    // Fetch candidate services for the current app mode only.
    let query = supabase
      .from("services")
      .select("id, name, base_price_min, base_price_max, is_active")
      .eq("is_active", true);
    if (explicitIds.length > 0) {
      query = query.in("id", explicitIds);
    } else if (modeId) {
      query = query.eq("mode_id", modeId);
    }

    const { data: services, error: servicesErr } = await withTransientRetry(
      async () => {
        const result = await query;
        if (result.error && isTransientUpstreamError(result.error)) {
          throw result.error;
        }
        return result;
      },
    );
    if (servicesErr) {
      console.error("[pricing] quote-bulk services lookup error:", servicesErr);
      return NextResponse.json(
        { error: "Failed to load services" },
        { status: 503 },
      );
    }

    const serviceRows = services ?? [];
    const serviceIds = serviceRows.map((s: { id: string }) => String(s.id));

    const nearbyByService =
      lat != null && lng != null
        ? await countOnlineProvidersNearbyForServices(
            supabase,
            serviceIds,
            lat,
            lng,
            undefined,
            onlineMode,
          )
        : new Map();

    const items: BulkQuoteEntry[] = [];
    let nextIndex = 0;
    const quoteService = async (svc: {
      id: string;
      base_price_min?: number | null;
      base_price_max?: number | null;
    }) => {
      const serviceId = String(svc.id);
      const baseMin = Number(svc.base_price_min);
      const baseMax = Number(svc.base_price_max);
      let legacyBase: number | null = null;
      if (Number.isFinite(baseMin) && Number.isFinite(baseMax) && baseMin > 0 && baseMax > 0) {
        legacyBase = Math.round((baseMin + baseMax) / 2);
      } else if (Number.isFinite(baseMin) && baseMin > 0) {
        legacyBase = baseMin;
      } else if (Number.isFinite(baseMax) && baseMax > 0) {
        legacyBase = baseMax;
      }

      const nearby = nearbyByService.get(serviceId);
      const marketClosed = nearby?.marketClosed ?? false;
      const onlineNearby = nearby?.count ?? 0;

      let entry: BulkQuoteEntry = {
        service_id: serviceId,
        customer_service_price: null,
        customer_total: null,
        provider_service_price: null,
        provider_total: null,
        multiplier: null,
        used_capacity_pct: null,
        base_price_source: "none",
        is_active: false,
        currency: DEFAULT_CURRENCY,
        legacy_base_price: legacyBase,
        market_closed: marketClosed,
        online_providers_nearby: onlineNearby,
      };

      try {
        const quote = await buildQuote(supabase, {
          serviceId,
          customerLat: lat,
          customerLng: lng,
          deliveryMode,
          addonIds: [],
          areaId,
          preferLiveCapacity: false,
          marketClosed,
          onlineProvidersNearby: onlineNearby,
        });
        if (quote) {
          entry = {
            ...entry,
            customer_service_price: quote.customerServicePrice,
            customer_total: quote.customerTotal,
            provider_service_price: quote.providerServicePrice,
            provider_total: quote.providerTotal,
            multiplier: quote.multiplier,
            used_capacity_pct: quote.usedCapacityPct,
            base_price_source: quote.basePriceSource,
            is_active: quote.basePriceIsActive,
            market_closed: quote.marketClosed,
            online_providers_nearby: quote.onlineProvidersNearby,
          };
        }
      } catch (e) {
        console.error("[pricing] quote-bulk per-service error:", serviceId, e);
      }

      items.push(entry);
    };

    const workerCount = Math.min(BULK_QUOTE_CONCURRENCY, serviceRows.length || 1);
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (nextIndex < serviceRows.length) {
          const row = serviceRows[nextIndex];
          nextIndex += 1;
          await quoteService(row);
        }
      }),
    );

    return NextResponse.json({
      area_id: areaId,
      delivery_mode: deliveryMode,
      currency: DEFAULT_CURRENCY,
      count: items.length,
      items,
    });
  } catch (error) {
    console.error("[pricing] quote-bulk error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
