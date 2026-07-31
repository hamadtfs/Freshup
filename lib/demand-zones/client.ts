import { gridIdToBounds, latLngToGridId } from "@/lib/demand-zones/grid";
import type { DemandZoneTier } from "@/lib/demand-zones/tiers";

export type DemandZoneChip = {
  tier: DemandZoneTier;
  label: string;
  used_capacity_pct: number;
};

export type DemandZoneApiRow = {
  grid_id: string;
  tier: DemandZoneTier;
  label?: string;
  used_capacity_pct?: number;
  center_lat?: number;
  center_lng?: number;
};

function bboxForPoint(lat: number, lng: number) {
  const bounds = gridIdToBounds(latLngToGridId(lat, lng));
  if (!bounds) {
    const pad = 0.005;
    return {
      min_lat: lat - pad,
      max_lat: lat + pad,
      min_lng: lng - pad,
      max_lng: lng + pad,
    };
  }
  return {
    min_lat: bounds.minLat,
    max_lat: bounds.maxLat,
    min_lng: bounds.minLng,
    max_lng: bounds.maxLng,
  };
}

/** Fetch all demand cells in a map viewport bounding box (for fill overlay). */
export async function fetchDemandZonesInBbox(
  accessToken: string,
  params: {
    serviceId: string;
    audience: "customer" | "provider";
    minLat: number;
    minLng: number;
    maxLat: number;
    maxLng: number;
    centerLat?: number;
    centerLng?: number;
    language?: "en" | "no";
  },
  signal?: AbortSignal,
): Promise<DemandZoneApiRow[]> {
  const { serviceId, audience, minLat, minLng, maxLat, maxLng } = params;
  if (!serviceId.trim() || !accessToken.trim()) return [];
  if (
    !Number.isFinite(minLat) ||
    !Number.isFinite(minLng) ||
    !Number.isFinite(maxLat) ||
    !Number.isFinite(maxLng)
  ) {
    return [];
  }

  const url = new URL("/api/demand-zones", window.location.origin);
  url.searchParams.set("service_id", serviceId);
  url.searchParams.set("audience", audience);
  url.searchParams.set("lang", params.language === "en" ? "en" : "no");
  url.searchParams.set("min_lat", String(minLat));
  url.searchParams.set("max_lat", String(maxLat));
  url.searchParams.set("min_lng", String(minLng));
  url.searchParams.set("max_lng", String(maxLng));
  if (Number.isFinite(params.centerLat) && Number.isFinite(params.centerLng)) {
    url.searchParams.set("center_lat", String(params.centerLat));
    url.searchParams.set("center_lng", String(params.centerLng));
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  });
  if (!res.ok) return [];

  const data = (await res.json()) as { zones?: DemandZoneApiRow[] };
  return (data.zones ?? []).filter(
    (z) =>
      typeof z.grid_id === "string" &&
      (z.tier === "green" || z.tier === "blue" || z.tier === "red"),
  );
}

/** Text-only demand read for map center (no polygon overlay). */
export async function fetchDemandZoneAtPoint(
  accessToken: string,
  params: {
    lat: number;
    lng: number;
    serviceId: string;
    audience: "customer" | "provider";
    language: "en" | "no";
  },
): Promise<DemandZoneChip | null> {
  const { lat, lng, serviceId, audience, language } = params;
  if (!serviceId.trim() || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  const box = bboxForPoint(lat, lng);
  const url = new URL("/api/demand-zones", window.location.origin);
  url.searchParams.set("service_id", serviceId);
  url.searchParams.set("audience", audience);
  url.searchParams.set("lang", language);
  url.searchParams.set("min_lat", String(box.min_lat));
  url.searchParams.set("max_lat", String(box.max_lat));
  url.searchParams.set("min_lng", String(box.min_lng));
  url.searchParams.set("max_lng", String(box.max_lng));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    zones?: Array<{
      tier?: DemandZoneTier;
      label?: string;
      used_capacity_pct?: number;
      center_lat?: number;
      center_lng?: number;
    }>;
  };

  const zones = data.zones ?? [];
  if (zones.length === 0) return null;

  let best = zones[0];
  let bestDist = Infinity;
  for (const z of zones) {
    const clat = Number(z.center_lat);
    const clng = Number(z.center_lng);
    if (!Number.isFinite(clat) || !Number.isFinite(clng)) continue;
    const d =
      (clat - lat) * (clat - lat) + (clng - lng) * (clng - lng);
    if (d < bestDist) {
      bestDist = d;
      best = z;
    }
  }

  const tier = best.tier;
  if (tier !== "green" && tier !== "blue" && tier !== "red") return null;

  return {
    tier,
    label: String(best.label || ""),
    used_capacity_pct: Number(best.used_capacity_pct) || 0,
  };
}

export function demandTierDotClass(tier: DemandZoneTier): string {
  switch (tier) {
    case "green":
      return "bg-green-500";
    case "red":
      return "bg-red-500";
    default:
      return "bg-blue-500";
  }
}
