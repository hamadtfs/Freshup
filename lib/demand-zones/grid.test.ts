import { describe, expect, it } from "vitest";
import {
  gridIdToCenter,
  gridIdsAroundCenterInBbox,
  gridIdsInBbox,
} from "./grid";

describe("gridIdsInBbox", () => {
  it("samples around map center when viewport exceeds the cell cap", () => {
    const minLat = 31.45;
    const maxLat = 31.65;
    const minLng = 74.25;
    const maxLng = 74.45;
    const centerLat = 31.55;
    const centerLng = 74.35;

    const ids = gridIdsInBbox(minLat, minLng, maxLat, maxLng, 40, {
      centerLat,
      centerLng,
    });

    expect(ids.length).toBe(40);
    const centers = ids
      .map((id) => gridIdToCenter(id))
      .filter((c): c is { lat: number; lng: number } => !!c);
    expect(centers.length).toBe(40);

    const avgLat =
      centers.reduce((sum, c) => sum + c.lat, 0) / centers.length;
    const avgLng =
      centers.reduce((sum, c) => sum + c.lng, 0) / centers.length;

    expect(Math.abs(avgLat - centerLat)).toBeLessThan(0.08);
    expect(Math.abs(avgLng - centerLng)).toBeLessThan(0.08);
    expect(Math.min(...centers.map((c) => c.lat))).toBeGreaterThan(minLat);
    expect(Math.max(...centers.map((c) => c.lat))).toBeLessThan(maxLat);
  });

  it("includes center ring cells inside bbox", () => {
    const ids = gridIdsAroundCenterInBbox(
      59.9,
      10.7,
      60.0,
      10.85,
      59.95,
      10.78,
      25,
    );
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThanOrEqual(25);
  });
});
