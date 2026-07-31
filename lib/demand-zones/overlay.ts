import { gridIdToCenter } from "./grid";
import type { DemandZoneTier } from "./tiers";
import { TIER_HIGH_MIN, TIER_LOW_MAX } from "./tiers";

/**
 * Smooth demand heatmap on the ~1 km grid using the app palette:
 * green / blue / red (same as service cards and chips).
 */

/** Overall heatmap layer opacity (shared by green / blue / red). */
export const DEMAND_HEATMAP_OPACITY = 0.64;

/** Drop only near-zero weights; keep moderate cells visible. */
export const HEATMAP_MIN_FEATURE_WEIGHT = 0.04;

/** Match green/red weight scale so blob size stays consistent. */
export const HEATMAP_BLUE_TIER_SCALE = 1;

/** @deprecated Alias kept for older imports. */
export const DEMAND_ZONE_FILL_OPACITY = DEMAND_HEATMAP_OPACITY;

/** @deprecated Alias for map layer paint. */
export const DEMAND_ZONE_GLOW_OPACITY = DEMAND_HEATMAP_OPACITY;

/** @deprecated Circle / polygon overlay removed. */
export const DEMAND_ZONE_CELL_INFLATE = 0;

/** @deprecated Circle overlay removed. */
export const DEMAND_ZONE_GLOW_BLUR = 1;

/** All three tiers render on the map (smooth blended zones). */
export const DEMAND_ZONE_RENDER_NEUTRAL_ON_MAP = true;

/**
 * Soft pastel palette — same softness / size treatment across tiers.
 * Blue uses blue-400 (not blue-300 washout, not blue-500 heavy).
 */
export const HEATMAP_GREEN_RGB = "74, 222, 128";
export const HEATMAP_BLUE_RGB = "96, 165, 250";
export const HEATMAP_RED_RGB = "248, 113, 113";

/**
 * Heatmap radius in screen pixels. ~1× the 1 km grid at default zoom:
 * merges cell edges into soft blobs without painting the entire viewport.
 */
export const HEATMAP_RADIUS_EXPRESSION = [
  "interpolate",
  ["exponential", 2],
  ["zoom"],
  10,
  28,
  11,
  46,
  12,
  74,
  13,
  104,
  14,
  175,
  15,
  295,
  16,
  500,
] as const;

export const HEATMAP_INTENSITY_EXPRESSION = [
  "interpolate",
  ["linear"],
  ["zoom"],
  10,
  0.48,
  12,
  0.68,
  13,
  0.82,
  14,
  0.92,
  15,
  1.02,
  16,
  1.12,
] as const;

export type DemandZoneOverlayCell = {
  grid_id: string;
  tier: DemandZoneTier;
  used_capacity_pct?: number;
};

export type HeatmapTierWeights = {
  weight_green: number;
  weight_blue: number;
  weight_red: number;
};

export function tierGlowColor(tier: DemandZoneTier): string {
  switch (tier) {
    case "green":
      return "#4ade80";
    case "red":
      return "#f87171";
    default:
      return "#60a5fa";
  }
}

/** @deprecated Polygon fill palette. */
export function tierFillColor(tier: DemandZoneTier): string {
  switch (tier) {
    case "green":
      return "#22c55e";
    case "red":
      return "#ef4444";
    default:
      return "#3b82f6";
  }
}

export function shouldRenderZoneOnMap(tier: DemandZoneTier): boolean {
  return tier === "green" || tier === "blue" || tier === "red";
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * How strongly a cell should glow on its tier's heatmap layer.
 * Tier is audience-adjusted (provider green = high demand even when pct is high).
 */
export function heatmapTierStrength(
  usedCapacityPct: number,
  tier: DemandZoneTier,
): number {
  const pct = Number(usedCapacityPct);
  if (!Number.isFinite(pct)) return 0;

  const mid = (TIER_LOW_MAX + TIER_HIGH_MIN) / 2;
  const halfBand = (TIER_HIGH_MIN - TIER_LOW_MAX) / 2;

  switch (tier) {
    case "green":
      // Customer many-available (low pct) OR provider high-demand (high pct).
      return Math.max(
        clamp01(1 - pct / TIER_LOW_MAX),
        clamp01((pct - TIER_HIGH_MIN) / (100 - TIER_HIGH_MIN)),
      );
    case "red":
      // Customer almost-full (high pct) OR provider low-demand (low pct).
      return Math.max(
        clamp01((pct - TIER_HIGH_MIN) / (100 - TIER_HIGH_MIN)),
        clamp01((TIER_LOW_MAX - pct) / TIER_LOW_MAX),
      );
    default:
      return clamp01(1 - Math.abs(pct - mid) / halfBand);
  }
}

/**
 * Per-tier weights for stacked green / blue / red heatmap layers.
 * `tier` is already audience-adjusted from the demand-zones API.
 */
export function heatmapTierWeights(
  usedCapacityPct: number,
  tier: DemandZoneTier,
): HeatmapTierWeights {
  const strength = Math.pow(
    heatmapTierStrength(usedCapacityPct, tier),
    1.1,
  );
  if (strength <= HEATMAP_MIN_FEATURE_WEIGHT) {
    return { weight_green: 0, weight_blue: 0, weight_red: 0 };
  }

  switch (tier) {
    case "green":
      return { weight_green: strength, weight_blue: 0, weight_red: 0 };
    case "red":
      return { weight_green: 0, weight_blue: 0, weight_red: strength };
    default:
      return {
        weight_green: 0,
        weight_blue: strength * HEATMAP_BLUE_TIER_SCALE,
        weight_red: 0,
      };
  }
}

/** @deprecated Use heatmapTierWeights */
export function heatmapHotWeight(
  usedCapacityPct: number,
  _audience?: string,
): number {
  return heatmapTierWeights(usedCapacityPct, "red").weight_red;
}

/** @deprecated Use heatmapTierWeights */
export function heatmapCoolWeight(
  usedCapacityPct: number,
  _audience?: string,
): number {
  return heatmapTierWeights(usedCapacityPct, "green").weight_green;
}

/**
 * Point features with green / blue / red weights for stacked heatmap layers.
 */
export function demandZonesToHeatmapGeoJSON(
  zones: ReadonlyArray<DemandZoneOverlayCell>,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];

  for (const zone of zones) {
    if (!shouldRenderZoneOnMap(zone.tier)) continue;

    const pct = Number(zone.used_capacity_pct);
    if (!Number.isFinite(pct) || pct < 0) continue;

    const center = gridIdToCenter(zone.grid_id);
    if (!center) continue;

    const weights = heatmapTierWeights(pct, zone.tier);
    if (
      weights.weight_green <= HEATMAP_MIN_FEATURE_WEIGHT &&
      weights.weight_blue <= HEATMAP_MIN_FEATURE_WEIGHT &&
      weights.weight_red <= HEATMAP_MIN_FEATURE_WEIGHT
    ) {
      continue;
    }

    features.push({
      type: "Feature",
      properties: {
        grid_id: zone.grid_id,
        tier: zone.tier,
        used_capacity_pct: pct,
        weight_green: weights.weight_green,
        weight_blue: weights.weight_blue,
        weight_red: weights.weight_red,
      },
      geometry: {
        type: "Point",
        coordinates: [center.lng, center.lat],
      },
    });
  }

  return { type: "FeatureCollection", features };
}

/** @deprecated Use demandZonesToHeatmapGeoJSON */
export function demandZonesToSoftOverlayGeoJSON(
  zones: ReadonlyArray<DemandZoneOverlayCell>,
): GeoJSON.FeatureCollection {
  return demandZonesToHeatmapGeoJSON(zones);
}

/** @deprecated */
export function demandZonesToGeoJSON(
  zones: ReadonlyArray<DemandZoneOverlayCell>,
): GeoJSON.FeatureCollection {
  return demandZonesToHeatmapGeoJSON(zones);
}

/** Soft edges with visible mid-tones; transparent only at very low density. */
export function heatmapColorRamp(rgb: string): unknown[] {
  return [
    "interpolate",
    ["linear"],
    ["heatmap-density"],
    0,
    "rgba(0,0,0,0)",
    0.1,
    "rgba(0,0,0,0)",
    0.18,
    `rgba(${rgb}, 0.07)`,
    0.32,
    `rgba(${rgb}, 0.2)`,
    0.52,
    `rgba(${rgb}, 0.34)`,
    0.76,
    `rgba(${rgb}, 0.46)`,
    1,
    `rgba(${rgb}, 0.54)`,
  ];
}
