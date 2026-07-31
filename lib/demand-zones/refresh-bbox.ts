import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeDemandZonesForGridIds,
  upsertDemandZones,
} from "@/lib/demand-zones/compute-zone";
import { gridIdsInBbox } from "@/lib/demand-zones/grid";

/** Greater Oslo bbox — default cron refresh area until product defines regions. */
export const DEFAULT_DEMAND_REFRESH_BBOX = {
  minLat: 59.75,
  minLng: 10.55,
  maxLat: 60.05,
  maxLng: 11.15,
};

export type RefreshDemandZonesResult = {
  service_ids: string[];
  grid_cells: number;
  upserted: number;
  errors: string[];
};

/**
 * Recompute demand_zones for all grid cells in bbox × each service id.
 * Safe to call from cron; skips cells that fail individually.
 */
export async function refreshDemandZonesInBbox(
  supabase: SupabaseClient,
  serviceIds: string[],
  bbox: {
    minLat: number;
    minLng: number;
    maxLat: number;
    maxLng: number;
  },
  maxCellsPerService = 120,
): Promise<RefreshDemandZonesResult> {
  const gridIds = gridIdsInBbox(
    bbox.minLat,
    bbox.minLng,
    bbox.maxLat,
    bbox.maxLng,
    maxCellsPerService,
  );

  const errors: string[] = [];
  let upserted = 0;

  for (const serviceId of serviceIds) {
    const sid = String(serviceId).trim();
    if (!sid) continue;

    try {
      const computed = await computeDemandZonesForGridIds(
        supabase,
        gridIds,
        sid,
      );
      if (computed.length > 0) {
        await upsertDemandZones(supabase, computed);
        upserted += computed.length;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${sid}: ${msg}`);
    }
  }

  return {
    service_ids: serviceIds.filter(Boolean),
    grid_cells: gridIds.length,
    upserted,
    errors: errors.slice(0, 20),
  };
}
