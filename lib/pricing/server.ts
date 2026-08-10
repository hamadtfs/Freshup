/**
 * Server-side helpers that bridge the pure pricing engine (`./engine`)
 * with Supabase. These functions perform DB I/O and live behind
 * Next.js Route Handlers — they are NOT safe to import in client code.
 */

import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { resolveCanonicalService, serviceIdCandidates } from "@/lib/service-id";
import {
  DEFAULT_CURRENCY,
  MIN_AREA_PROVIDERS,
  computeQuote,
  type AddonInput,
  type QuoteBreakdown,
} from "./index";
import {
  UNKNOWN_AREA_ID,
  resolvePricingAreaDefinition,
  type PricingArea,
} from "./areas";
import {
  resolveUsedCapacityPct,
  type UsedCapacitySource,
} from "./used-capacity";
import { countOnlineProvidersNearby } from "./nearby-online-providers";

type AnyClient = ReturnType<typeof createAdminClient>;

/**
 * Dev/QA escape hatch: lets you exercise the full dynamic-pricing engine
 * before 5 providers have signed up in an area. Set in `.env.local`:
 *
 *   PRICING_DEV_MIN_PROVIDERS=1
 *
 * When unset, falls back to the spec-mandated MIN_AREA_PROVIDERS (5).
 * Production deployments must leave this env var unset.
 */
const DEV_MIN_PROVIDERS_OVERRIDE = (() => {
  const raw = process.env.PRICING_DEV_MIN_PROVIDERS;
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
})();
const ACTIVE_BASE_PRICE_THRESHOLD = DEV_MIN_PROVIDERS_OVERRIDE ?? MIN_AREA_PROVIDERS;

async function ensurePricingAreaRow(
  supabase: AnyClient,
  area: PricingArea,
): Promise<void> {
  const { error } = await supabase.from("pricing_areas").upsert(
    {
      id: area.id,
      name: area.name,
      country: area.country,
      center_lat: area.center.lat,
      center_lng: area.center.lng,
      radius_km: area.radiusKm,
      is_active: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) {
    console.error("[pricing] ensurePricingAreaRow failed:", error);
    throw error;
  }
}

export interface ResolvedAreaInfo {
  /** Area id from `pricing_areas` (or `'unknown'`). */
  areaId: string;
  /** Whether the GPS resolved to a known area. */
  isKnown: boolean;
}

/** Resolve a (lat, lng) pair to a `pricing_areas.id` using the SQL helper. */
export async function resolveAreaIdFromDb(
  supabase: AnyClient,
  lat: number | null | undefined,
  lng: number | null | undefined,
): Promise<ResolvedAreaInfo> {
  if (typeof lat !== "number" || typeof lng !== "number") {
    return { areaId: UNKNOWN_AREA_ID, isKnown: false };
  }

  const { data, error } = await supabase.rpc("resolve_pricing_area_id", {
    p_lat: lat,
    p_lng: lng,
  });
  let id = (data as string | null) ?? UNKNOWN_AREA_ID;
  if (error) {
    console.error("[pricing] resolve_pricing_area_id failed:", error);
    id = UNKNOWN_AREA_ID;
  }

  if (id === UNKNOWN_AREA_ID) {
    const area = resolvePricingAreaDefinition({ lat, lng });
    if (!area) {
      return { areaId: UNKNOWN_AREA_ID, isKnown: false };
    }
    await ensurePricingAreaRow(supabase, area);
    return { areaId: area.id, isKnown: true };
  }

  return { areaId: id, isKnown: true };
}

export interface BasePriceLookup {
  /** Provider-side base price as computed by the trimmed mean (or null). */
  basePrice: number | null;
  /** Number of provider submissions that fed the trimmed mean. */
  sampleSize: number;
  /** True once the spec's 5-provider threshold is met. */
  isActive: boolean;
  /** Source of the value: `'computed'` (active aggregate) or `'fallback'` (services.base_price_*). */
  source: "computed" | "fallback" | "none";
}

/**
 * Fetch the active base price for (area, service) from `area_base_prices`.
 * Falls back to the legacy `services.base_price_min/max` average when the
 * aggregate is not yet active (fewer than 5 providers).
 *
 * The fallback is *intentional* — the spec activates dynamic pricing only
 * after 5 providers have submitted, but the existing app must keep working
 * before then. See spec §2.1: "A base price only becomes active for an area
 * once at least 5 providers have submitted prices for that service."
 */
export async function getActiveBasePrice(
  supabase: AnyClient,
  serviceId: string,
  areaId: string,
): Promise<BasePriceLookup> {
  const candidateIds = serviceIdCandidates(serviceId);

  if (areaId !== UNKNOWN_AREA_ID) {
    const { data: rows, error } = await supabase
      .from("area_base_prices")
      .select("base_price, sample_size, is_active")
      .eq("area_id", areaId)
      .in("service_id", candidateIds);
    if (error) {
      console.error("[pricing] area_base_prices read error:", error);
    } else if (rows && rows.length > 0) {
      // Spec §2.1 says is_active=true once 5 providers have submitted.
      // For dev/QA we also accept any row whose sample_size meets the
      // configured threshold (lets PRICING_DEV_MIN_PROVIDERS=1 unlock
      // dynamic pricing with a single provider input).
      const active = rows.find((r: any) => {
        if (r.base_price == null) return false;
        if (r.is_active === true) return true;
        const samples = Number(r.sample_size ?? 0);
        return Number.isFinite(samples) && samples >= ACTIVE_BASE_PRICE_THRESHOLD;
      });
      if (active && active.base_price != null) {
        return {
          basePrice: Number(active.base_price),
          sampleSize: Number(active.sample_size ?? 0),
          isActive: true,
          source: "computed",
        };
      }
    }
  }

  // Fallback: services.base_price_min/max average (preserves legacy behaviour).
  const canonical = await resolveCanonicalService<{
    id: string;
    base_price_min: number | null;
    base_price_max: number | null;
  }>(supabase, serviceId, "id, base_price_min, base_price_max");
  if (!canonical) {
    return { basePrice: null, sampleSize: 0, isActive: false, source: "none" };
  }

  const min = Number(canonical.base_price_min);
  const max = Number(canonical.base_price_max);
  let fallback: number | null = null;
  if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && max > 0) {
    fallback = (min + max) / 2;
  } else if (Number.isFinite(min) && min > 0) {
    fallback = min;
  } else if (Number.isFinite(max) && max > 0) {
    fallback = max;
  }
  return {
    basePrice: fallback,
    sampleSize: 0,
    isActive: false,
    source: fallback != null ? "fallback" : "none",
  };
}

export async function getUsedCapacityPct(
  supabase: AnyClient,
  serviceId: string,
  areaId: string,
  coords?: { lat: number; lng: number } | null,
): Promise<number> {
  const result = await resolveUsedCapacityPct(
    supabase,
    serviceId,
    areaId,
    coords,
  );
  return result.pct;
}

export interface QuoteRequest {
  serviceId: string;
  customerLat?: number | null;
  customerLng?: number | null;
  /** Provider lat/lng (only needed for at-provider mode km calc). */
  providerLat?: number | null;
  providerLng?: number | null;
  deliveryMode?: "home" | "provider" | null;
  /** Explicit home-visit distance when the provider is not yet assigned. */
  deliveryKm?: number | null;
  addonIds?: string[];
  /** Pre-resolved pricing area (quote-bulk resolves once for all services). */
  areaId?: string | null;
  /** Recompute ~1 km grid capacity instead of the 5-minute cache (price lock). */
  preferLiveCapacity?: boolean;
  /**
   * Precomputed closed-market flag from quote-bulk batch count.
   * When set, skips a per-service nearby-provider recount.
   */
  marketClosed?: boolean;
  onlineProvidersNearby?: number;
}

export interface QuoteResponse extends QuoteBreakdown {
  serviceId: string;
  areaId: string;
  currency: string;
  basePriceSource: BasePriceLookup["source"];
  basePriceSampleSize: number;
  basePriceIsActive: boolean;
  usedCapacitySource?: UsedCapacitySource;
  /** No live providers for this service within the 10 km match radius. */
  marketClosed: boolean;
  onlineProvidersNearby: number;
}

/**
 * Compose a fresh quote for a customer-facing service card or booking flow.
 * Combines (area resolution) + (base price) + (used_capacity → multiplier) +
 * (delivery fee) + (add-ons) and returns a single breakdown.
 */
export async function buildQuote(
  supabase: AnyClient,
  req: QuoteRequest,
): Promise<QuoteResponse | null> {
  const lat =
    typeof req.customerLat === "number" && Number.isFinite(req.customerLat)
      ? req.customerLat
      : null;
  const lng =
    typeof req.customerLng === "number" && Number.isFinite(req.customerLng)
      ? req.customerLng
      : null;

  const areaId =
    typeof req.areaId === "string" && req.areaId.trim() !== ""
      ? req.areaId.trim()
      : (await resolveAreaIdFromDb(supabase, lat, lng)).areaId;

  const canonical = await resolveCanonicalService<{ id: string }>(
    supabase,
    req.serviceId,
    "id",
  );
  const serviceId = canonical?.id ?? req.serviceId;

  const baseInfo = await getActiveBasePrice(supabase, serviceId, areaId);
  if (!baseInfo.basePrice || baseInfo.basePrice <= 0) return null;

  const capacity = await resolveUsedCapacityPct(
    supabase,
    serviceId,
    areaId,
    lat != null && lng != null ? { lat, lng } : null,
    { preferLive: !!req.preferLiveCapacity },
  );
  const usedCapacityPct = capacity.pct;

  let marketClosed = false;
  let onlineProvidersNearby = 0;
  if (typeof req.marketClosed === "boolean") {
    marketClosed = req.marketClosed;
    onlineProvidersNearby = Math.max(0, Number(req.onlineProvidersNearby) || 0);
  } else if (lat != null && lng != null) {
    const nearby = await countOnlineProvidersNearby(
      supabase,
      serviceId,
      lat,
      lng,
      undefined,
      req.deliveryMode === "home" || req.deliveryMode === "provider"
        ? req.deliveryMode
        : null,
    );
    marketClosed = nearby.marketClosed;
    onlineProvidersNearby = nearby.count;
  }

  const isHomeVisit = req.deliveryMode === "home";

  // Delivery distance: only used in home-visit mode. We don't know which
  // provider will be assigned yet, so use 0 here unless caller provided one.
  let deliveryKm = 0;
  if (
    isHomeVisit &&
    typeof req.deliveryKm === "number" &&
    Number.isFinite(req.deliveryKm) &&
    req.deliveryKm >= 0
  ) {
    deliveryKm = req.deliveryKm;
  } else if (
    isHomeVisit &&
    typeof req.providerLat === "number" &&
    typeof req.providerLng === "number" &&
    typeof lat === "number" &&
    typeof lng === "number"
  ) {
    const { haversineKm } = await import("@/lib/geo");
    deliveryKm = haversineKm(
      { lat, lng },
      { lat: req.providerLat, lng: req.providerLng },
    );
  }

  // Resolve add-on rows so we can derive customer / provider shares.
  let addons: AddonInput[] = [];
  const requestedAddonIds = (req.addonIds ?? []).filter(
    (id) => typeof id === "string" && id.trim() !== "",
  );
  if (requestedAddonIds.length > 0) {
    // Find the canonical service id for the addon FK lookup.
    if (canonical) {
      const { data: addonRows, error: addonsErr } = await supabase
        .from("service_addons")
        .select("id, name, extra_price")
        .eq("service_id", serviceId)
        .eq("is_active", true)
        .in("id", requestedAddonIds);
      if (addonsErr) {
        console.error("[pricing] service_addons lookup failed:", addonsErr);
      } else if (addonRows) {
        addons = addonRows.map((row: any) => ({
          id: String(row.id),
          name: row.name ?? undefined,
          customerPrice: Number(row.extra_price) || 0,
        }));
      }
    }
  }

  const breakdown = computeQuote({
    providerBasePrice: baseInfo.basePrice,
    usedCapacityPct,
    // Closed market: show base price only (no −30% / +30% dynamic multiplier).
    ...(marketClosed ? { multiplierOverride: 0 } : {}),
    deliveryKm,
    isHomeVisit,
    addons,
  });

  return {
    ...breakdown,
    serviceId,
    areaId,
    currency: DEFAULT_CURRENCY,
    basePriceSource: baseInfo.source,
    basePriceSampleSize: baseInfo.sampleSize,
    basePriceIsActive: baseInfo.isActive,
    usedCapacitySource: capacity.source,
    marketClosed,
    onlineProvidersNearby,
  };
}
