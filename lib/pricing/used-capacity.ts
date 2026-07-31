import type { SupabaseClient } from "@supabase/supabase-js";
import { latLngToGridId } from "@/lib/demand-zones/grid";
import {
  computeDemandZoneForGrid,
  isDemandZoneStale,
  upsertDemandZone,
} from "@/lib/demand-zones/compute-zone";
import { serviceIdCandidates } from "@/lib/service-id";
import { UNKNOWN_AREA_ID } from "./areas";

export type UsedCapacitySource =
  | "demand_grid_cache"
  | "demand_grid_live"
  | "pricing_area_rpc"
  | "default";

export type UsedCapacityResult = {
  pct: number;
  source: UsedCapacitySource;
};

type AnyClient = SupabaseClient;

/**
 * Live ~1 km grid capacity (same logic as demand_zones refresh + map overlay).
 */
async function liveDemandGridCapacity(
  supabase: AnyClient,
  serviceId: string,
  lat: number,
  lng: number,
): Promise<number | null> {
  const gridId = latLngToGridId(lat, lng);
  for (const id of serviceIdCandidates(serviceId)) {
    try {
      const row = await computeDemandZoneForGrid(supabase, gridId, id);
      if (!row) continue;
      void upsertDemandZone(supabase, row).catch((err) =>
        console.error("[pricing] demand zone upsert failed:", err),
      );
      return row.used_capacity_pct;
    } catch (err) {
      console.error("[pricing] computeDemandZoneForGrid failed:", id, err);
    }
  }
  return null;
}

async function cachedDemandGridCapacity(
  supabase: AnyClient,
  serviceId: string,
  lat: number,
  lng: number,
): Promise<number | null> {
  const gridId = latLngToGridId(lat, lng);
  for (const id of serviceIdCandidates(serviceId)) {
    const { data: zone, error } = await supabase
      .from("demand_zones")
      .select("used_capacity_pct, computed_at")
      .eq("grid_id", gridId)
      .eq("service_id", id)
      .maybeSingle();
    if (error) {
      console.error("[pricing] demand_zones read error:", error);
      continue;
    }
    if (zone && !isDemandZoneStale(zone.computed_at)) {
      const pct = Number(zone.used_capacity_pct);
      if (Number.isFinite(pct)) return pct;
    }
  }
  return null;
}

/**
 * Resolve used capacity for dynamic pricing (spec §2.3).
 *
 * - Formula: (active_bookings_last_30min / online_providers) × 100 %
 * - Recalc cadence: reuse cached demand_zones for ~5 min; recompute only when
 *   stale/missing (prevents price jitter on every quote/lock).
 */
export type ResolveUsedCapacityOpts = {
  /** Skip the 5-minute demand_zones cache (price lock / post-booking refresh). */
  preferLive?: boolean;
};

/** Recompute and upsert the ~1 km demand cell for a point (e.g. after booking). */
export async function refreshDemandZoneAt(
  supabase: AnyClient,
  serviceId: string,
  lat: number,
  lng: number,
): Promise<void> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const gridId = latLngToGridId(lat, lng);
  for (const id of serviceIdCandidates(serviceId)) {
    try {
      const row = await computeDemandZoneForGrid(supabase, gridId, id);
      if (!row) continue;
      await upsertDemandZone(supabase, row);
      return;
    } catch (err) {
      console.error("[pricing] refreshDemandZoneAt failed:", id, err);
    }
  }
}

export async function resolveUsedCapacityPct(
  supabase: AnyClient,
  serviceId: string,
  areaId: string,
  coords?: { lat: number; lng: number } | null,
  opts?: ResolveUsedCapacityOpts,
): Promise<UsedCapacityResult> {
  if (
    coords &&
    typeof coords.lat === "number" &&
    Number.isFinite(coords.lat) &&
    typeof coords.lng === "number" &&
    Number.isFinite(coords.lng)
  ) {
    if (!opts?.preferLive) {
      const cached = await cachedDemandGridCapacity(
        supabase,
        serviceId,
        coords.lat,
        coords.lng,
      );
      if (cached != null) {
        return { pct: cached, source: "demand_grid_cache" };
      }
    }

    const live = await liveDemandGridCapacity(
      supabase,
      serviceId,
      coords.lat,
      coords.lng,
    );
    if (live != null) {
      return { pct: live, source: "demand_grid_live" };
    }
  }

  if (areaId !== UNKNOWN_AREA_ID) {
    for (const id of serviceIdCandidates(serviceId)) {
      const { data, error } = await supabase.rpc("compute_used_capacity", {
        p_area_id: areaId,
        p_service_id: id,
      });
      if (!error && data != null) {
        const pct = Number(data);
        if (Number.isFinite(pct)) {
          return { pct, source: "pricing_area_rpc" };
        }
      }
    }
  }

  return { pct: 0, source: "default" };
}
