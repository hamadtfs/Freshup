import type { SupabaseClient } from "@supabase/supabase-js";
import { haversineKm, type LatLng } from "@/lib/geo";
import { fetchDrivingDistanceKm } from "@/lib/maps/driving-route";
import { resolvePricingAreaDefinition } from "@/lib/pricing/areas";
import { estimateInterimHomeDeliveryKm } from "@/lib/pricing/interim-delivery-km";
import { providerPresenceCutoffIso } from "@/lib/provider/presence";
import { resolveCanonicalService } from "@/lib/service-id";

const OSLO_CENTER: LatLng = { lat: 59.9139, lng: 10.7522 };
const MIN_KM = 1;
const MAX_KM = 25;

export type HomeDeliveryKmSource =
  | "mapbox_nearest_provider"
  | "mapbox_area_center"
  | "osrm_nearest_provider"
  | "osrm_area_center"
  | "haversine_fallback";

function clampDeliveryKm(km: number): number {
  const rounded = Math.round(km * 10) / 10;
  return Math.min(MAX_KM, Math.max(MIN_KM, rounded));
}

async function drivingKmOrNull(
  from: LatLng,
  to: LatLng,
): Promise<{ km: number; router: "mapbox" | "osrm" } | null> {
  const result = await fetchDrivingDistanceKm(from, to);
  if (result == null) return null;
  return { km: clampDeliveryKm(result.km), router: result.source };
}

/**
 * Home-visit delivery km for pricing (150 + 10×km).
 * Uses Mapbox Directions when a Mapbox token is set, else OSRM;
 * then area centre, then straight-line estimate.
 */
export async function estimateHomeDeliveryDrivingKm(
  supabase: SupabaseClient,
  customer: LatLng,
  serviceIdRaw?: string | null,
): Promise<{ delivery_km: number; source: HomeDeliveryKmSource }> {
  const serviceId = serviceIdRaw?.trim() || "";
  let nearestProvider: LatLng | null = null;

  if (serviceId) {
    const canonical = await resolveCanonicalService<{ id: string }>(
      supabase,
      serviceId,
      "id",
    );
    const canonicalId = canonical?.id ? String(canonical.id) : serviceId;

    const { data: skills } = await supabase
      .from("provider_skills")
      .select("provider_id")
      .eq("service_id", canonicalId)
      .eq("is_active", true)
      .eq("available_now", true);

    const providerIds = [
      ...new Set((skills ?? []).map((s) => String(s.provider_id)).filter(Boolean)),
    ];

    if (providerIds.length > 0) {
      const { data: providers } = await supabase
        .from("provider_details")
        .select("id, lat, lng, is_online")
        .in("id", providerIds)
        .eq("is_online", true)
        .gte("last_online_at", providerPresenceCutoffIso());

      let bestKm = Infinity;
      for (const p of providers ?? []) {
        const lat = Number(p.lat);
        const lng = Number(p.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const d = haversineKm(customer, { lat, lng });
        if (d < bestKm) {
          bestKm = d;
          nearestProvider = { lat, lng };
        }
      }
    }
  }

  if (nearestProvider) {
    const driving = await drivingKmOrNull(customer, nearestProvider);
    if (driving != null) {
      return {
        delivery_km: driving.km,
        source:
          driving.router === "mapbox"
            ? "mapbox_nearest_provider"
            : "osrm_nearest_provider",
      };
    }
  }

  const area = resolvePricingAreaDefinition(customer);
  const center = area?.center ?? OSLO_CENTER;
  const centerDriving = await drivingKmOrNull(customer, center);
  if (centerDriving != null) {
    return {
      delivery_km: centerDriving.km,
      source:
        centerDriving.router === "mapbox"
          ? "mapbox_area_center"
          : "osrm_area_center",
    };
  }

  return {
    delivery_km: estimateInterimHomeDeliveryKm(customer),
    source: "haversine_fallback",
  };
}
