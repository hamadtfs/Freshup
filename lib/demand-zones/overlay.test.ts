import { describe, expect, it } from "vitest";
import {
  DEMAND_HEATMAP_OPACITY,
  DEMAND_ZONE_RENDER_NEUTRAL_ON_MAP,
  demandZonesToHeatmapGeoJSON,
  heatmapTierWeights,
  HEATMAP_BLUE_RGB,
  HEATMAP_GREEN_RGB,
  HEATMAP_RED_RGB,
  shouldRenderZoneOnMap,
  tierGlowColor,
} from "./overlay";

describe("demand zone heatmap overlay (green / blue / red)", () => {
  it("uses moderate opacity so streets stay visible", () => {
    expect(DEMAND_HEATMAP_OPACITY).toBeLessThan(0.9);
    expect(DEMAND_HEATMAP_OPACITY).toBeGreaterThan(0.4);
  });

  it("renders all three tiers on the map", () => {
    expect(DEMAND_ZONE_RENDER_NEUTRAL_ON_MAP).toBe(true);
    expect(shouldRenderZoneOnMap("blue")).toBe(true);
    expect(shouldRenderZoneOnMap("green")).toBe(true);
    expect(shouldRenderZoneOnMap("red")).toBe(true);
  });

  it("uses a soft pastel palette matched across tiers", () => {
    expect(tierGlowColor("green")).toBe("#4ade80");
    expect(tierGlowColor("red")).toBe("#f87171");
    expect(tierGlowColor("blue")).toBe("#60a5fa");
    expect(HEATMAP_GREEN_RGB).toBe("74, 222, 128");
    expect(HEATMAP_BLUE_RGB).toBe("96, 165, 250");
    expect(HEATMAP_RED_RGB).toBe("248, 113, 113");
  });

  it("assigns weights per tier band", () => {
    const green = heatmapTierWeights(12, "green");
    expect(green.weight_green).toBeGreaterThan(0.5);
    expect(green.weight_blue).toBe(0);
    expect(green.weight_red).toBe(0);

    const blue = heatmapTierWeights(50, "blue");
    expect(blue.weight_blue).toBeGreaterThan(0.7);
    expect(blue.weight_blue).toBeLessThanOrEqual(1);
    expect(blue.weight_green).toBe(0);
    expect(blue.weight_red).toBe(0);

    const red = heatmapTierWeights(88, "red");
    expect(red.weight_red).toBeGreaterThan(0.5);
    expect(red.weight_green).toBe(0);
    expect(red.weight_blue).toBe(0);
  });

  it("provider low-demand (red tier, low pct) still gets red heatmap weight", () => {
    const providerLow = heatmapTierWeights(12, "red");
    expect(providerLow.weight_red).toBeGreaterThan(0.5);
    expect(providerLow.weight_green).toBe(0);
  });

  it("provider high-demand (green tier, high pct) still gets green heatmap weight", () => {
    const providerHigh = heatmapTierWeights(88, "green");
    expect(providerHigh.weight_green).toBeGreaterThan(0.3);
    expect(providerHigh.weight_red).toBe(0);
  });

  it("builds weighted point features for three heatmap layers", () => {
    const collection = demandZonesToHeatmapGeoJSON([
      { grid_id: "g_535_-122", tier: "green", used_capacity_pct: 12 },
      { grid_id: "g_536_-122", tier: "blue", used_capacity_pct: 50 },
      { grid_id: "g_537_-122", tier: "red", used_capacity_pct: 88 },
    ]);
    expect(collection.features).toHaveLength(3);
    expect(collection.features[0]?.geometry.type).toBe("Point");
    expect(
      Number(
        collection.features.find((f) => f.properties?.tier === "green")
          ?.properties?.weight_green,
      ),
    ).toBeGreaterThan(0);
    expect(
      Number(
        collection.features.find((f) => f.properties?.tier === "blue")
          ?.properties?.weight_blue,
      ),
    ).toBeGreaterThan(0);
    expect(
      Number(
        collection.features.find((f) => f.properties?.tier === "red")
          ?.properties?.weight_red,
      ),
    ).toBeGreaterThan(0);
  });
});
