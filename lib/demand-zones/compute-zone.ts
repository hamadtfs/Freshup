import type { SupabaseClient } from "@supabase/supabase-js";
import { computeUsedCapacity } from "@/lib/pricing/engine";
import {
  DYNAMIC_RECALC_INTERVAL_MINUTES,
  USED_CAPACITY_WINDOW_MINUTES,
} from "@/lib/pricing/constants";
import { gridIdToBounds, gridIdToCenter } from "@/lib/demand-zones/grid";
import {
  providerPresenceCutoffIso,
} from "@/lib/provider/presence";

const ACTIVE_ORDER_STATUSES = [
  "pending",
  "offered",
  "assigned",
  "en_route",
  "arrived",
  "in_progress",
] as const;

const ACTIVE_ORDER_STATUSES_LEGACY = [
  "pending",
  "offered",
  "assigned",
  "en_route",
  "in_progress",
] as const;

async function fetchActiveOrdersForService(
  supabase: SupabaseClient,
  serviceId: string,
  since: string,
) {
  const run = (statuses: readonly string[]) =>
    supabase
      .from("orders")
      .select("id, customer_lat, customer_lng, status, created_at, service_id")
      .eq("service_id", serviceId)
      .eq("is_test", false)
      .in("status", [...statuses])
      .gte("created_at", since);

  let result = await run(ACTIVE_ORDER_STATUSES);
  if (
    result.error &&
    /arrived|enum|invalid input value/i.test(result.error.message)
  ) {
    result = await run(ACTIVE_ORDER_STATUSES_LEGACY);
  }
  return result;
}

export type DemandZoneRow = {
  grid_id: string;
  service_id: string;
  center_lat: number;
  center_lng: number;
  used_capacity_pct: number;
  active_bookings: number;
  online_providers: number;
  computed_at: string;
};

type GridCell = {
  gridId: string;
  bounds: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  };
  center: { lat: number; lng: number };
};

function pointInCell(
  lat: number,
  lng: number,
  bounds: GridCell["bounds"],
): boolean {
  return (
    lat >= bounds.minLat &&
    lat <= bounds.maxLat &&
    lng >= bounds.minLng &&
    lng <= bounds.maxLng
  );
}

function resolveGridCells(gridIds: string[]): GridCell[] {
  const cells: GridCell[] = [];
  for (const gridId of gridIds) {
    const bounds = gridIdToBounds(gridId);
    const center = gridIdToCenter(gridId);
    if (!bounds || !center) continue;
    cells.push({ gridId, bounds, center });
  }
  return cells;
}

async function fetchOnlineProviderLocations(
  supabase: SupabaseClient,
  serviceId: string,
) {
  // Stale-provider sweeps stay on cron only — demand-zone map loads must not
  // kick active providers offline while they are heartbeating.

  const { data: skills, error: skillsErr } = await supabase
    .from("provider_skills")
    .select("provider_id")
    .eq("service_id", serviceId)
    .eq("is_active", true)
    .eq("available_now", true);
  if (skillsErr) {
    throw new Error(`provider_skills: ${skillsErr.message}`);
  }

  const providerIds = [
    ...new Set((skills ?? []).map((s) => String(s.provider_id)).filter(Boolean)),
  ];
  if (providerIds.length === 0) return [] as Array<{ lat: number; lng: number }>;

  const cutoff = providerPresenceCutoffIso();
  const { data: providers, error: providersErr } = await supabase
    .from("provider_details")
    .select("id, lat, lng")
    .in("id", providerIds)
    .eq("is_online", true)
    .eq("stripe_payouts_enabled", true)
    .eq("admin_approved", true)
    .gte("last_online_at", cutoff);
  if (providersErr) {
    throw new Error(`provider_details: ${providersErr.message}`);
  }

  const out: Array<{ lat: number; lng: number }> = [];
  for (const p of providers ?? []) {
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      out.push({ lat, lng });
    }
  }
  return out;
}

/**
 * Compute many grid cells with shared order/provider queries (one round-trip each).
 */
export async function computeDemandZonesForGridIds(
  supabase: SupabaseClient,
  gridIds: string[],
  serviceId: string,
): Promise<DemandZoneRow[]> {
  const cells = resolveGridCells(gridIds);
  if (cells.length === 0) return [];

  const since = new Date(
    Date.now() - USED_CAPACITY_WINDOW_MINUTES * 60 * 1000,
  ).toISOString();

  const [{ data: orders, error: ordersErr }, providerLocations] =
    await Promise.all([
      fetchActiveOrdersForService(supabase, serviceId, since),
      fetchOnlineProviderLocations(supabase, serviceId),
    ]);
  if (ordersErr) {
    throw new Error(`orders: ${ordersErr.message}`);
  }

  const orderPoints: Array<{ lat: number; lng: number }> = [];
  for (const o of orders ?? []) {
    const lat = Number(o.customer_lat);
    const lng = Number(o.customer_lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      orderPoints.push({ lat, lng });
    }
  }

  const nowIso = new Date().toISOString();
  const rows: DemandZoneRow[] = [];

  for (const cell of cells) {
    let activeBookings = 0;
    for (const o of orderPoints) {
      if (pointInCell(o.lat, o.lng, cell.bounds)) activeBookings += 1;
    }

    let onlineProviders = 0;
    for (const p of providerLocations) {
      if (pointInCell(p.lat, p.lng, cell.bounds)) onlineProviders += 1;
    }

    const usedCapacityPct = computeUsedCapacity(activeBookings, onlineProviders);
    rows.push({
      grid_id: cell.gridId,
      service_id: serviceId,
      center_lat: cell.center.lat,
      center_lng: cell.center.lng,
      used_capacity_pct: Math.round(usedCapacityPct * 100) / 100,
      active_bookings: activeBookings,
      online_providers: onlineProviders,
      computed_at: nowIso,
    });
  }

  return rows;
}

export async function computeDemandZoneForGrid(
  supabase: SupabaseClient,
  gridId: string,
  serviceId: string,
): Promise<DemandZoneRow | null> {
  const rows = await computeDemandZonesForGridIds(
    supabase,
    [gridId],
    serviceId,
  );
  return rows[0] ?? null;
}

export async function upsertDemandZone(
  supabase: SupabaseClient,
  row: DemandZoneRow,
): Promise<void> {
  await upsertDemandZones(supabase, [row]);
}

export async function upsertDemandZones(
  supabase: SupabaseClient,
  rows: DemandZoneRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase.from("demand_zones").upsert(
    rows.map((row) => ({
      grid_id: row.grid_id,
      service_id: row.service_id,
      center_lat: row.center_lat,
      center_lng: row.center_lng,
      used_capacity_pct: row.used_capacity_pct,
      active_bookings: row.active_bookings,
      online_providers: row.online_providers,
      computed_at: row.computed_at,
      updated_at: row.computed_at,
    })),
    { onConflict: "grid_id,service_id" },
  );
  if (error) throw new Error(error.message);
}

const STALE_MS = DYNAMIC_RECALC_INTERVAL_MINUTES * 60 * 1000;

export function isDemandZoneStale(computedAt: string | null | undefined): boolean {
  if (!computedAt) return true;
  const t = new Date(computedAt).getTime();
  if (!Number.isFinite(t)) return true;
  return Date.now() - t > STALE_MS;
}
