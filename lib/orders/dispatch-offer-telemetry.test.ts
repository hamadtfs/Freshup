import { describe, expect, it } from "vitest";
import { offerDispatchTelemetry } from "./dispatchTiming";

describe("offerDispatchTelemetry", () => {
  it("maps step 0 to Batch 1 Gold", () => {
    expect(offerDispatchTelemetry(0)).toEqual({
      batch_index: 0,
      wave_index: 0,
      provider_tier: "gold",
    });
  });

  it("maps step 1 to Batch 1 Silver and step 2 to Bronze", () => {
    expect(offerDispatchTelemetry(1)).toEqual({
      batch_index: 0,
      wave_index: 1,
      provider_tier: "silver",
    });
    expect(offerDispatchTelemetry(2)).toEqual({
      batch_index: 0,
      wave_index: 2,
      provider_tier: "bronze",
    });
  });

  it("maps step 3 to Batch 2 Gold", () => {
    expect(offerDispatchTelemetry(3)).toEqual({
      batch_index: 1,
      wave_index: 3,
      provider_tier: "gold",
    });
  });
});
