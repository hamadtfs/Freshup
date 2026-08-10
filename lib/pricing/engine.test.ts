import { describe, expect, it } from "vitest";
import {
  computeDeliveryFee,
  computeDynamicMultiplier,
  computeQuote,
  computeTrimmedMeanBasePrice,
  computeUsedCapacity,
  providerPriceToCustomerPrice,
} from "./engine";

/** Provider base that yields 375 kr customer price at 50 % capacity (spec §2.3 table). */
const SPEC_PROVIDER_BASE = 300;

describe("FreshUp Pricing & Tier System v1.0 — §2.3 dynamic multiplier", () => {
  it("computes used_capacity as (active / online) × 100", () => {
    expect(computeUsedCapacity(7, 10)).toBe(70);
    // Bookings with zero live providers = saturated, not quiet.
    expect(computeUsedCapacity(3, 0)).toBe(300);
    // No bookings and no providers = 0% (closed market UI handles this separately).
    expect(computeUsedCapacity(0, 0)).toBe(0);
  });

  it.each([
    [0, -0.3, 262.5],
    [20, -0.18, 307.5],
    [30, -0.12, 330],
    [50, 0, 375],
    [70, 0.12, 420],
    [80, 0.18, 442.5],
    [100, 0.3, 487.5],
  ] as const)(
    "maps %i%% capacity → %f multiplier → %f kr customer price",
    (capacityPct, expectedMultiplier, expectedCustomerPrice) => {
      expect(computeDynamicMultiplier(capacityPct)).toBeCloseTo(
        expectedMultiplier,
        5,
      );
      const quote = computeQuote({
        providerBasePrice: SPEC_PROVIDER_BASE,
        usedCapacityPct: capacityPct,
        isHomeVisit: false,
      });
      expect(quote.customerServicePrice).toBe(expectedCustomerPrice);
    },
  );

  it("caps multiplier below 0 % and above 100 % capacity", () => {
    expect(computeDynamicMultiplier(-50)).toBe(-0.3);
    expect(computeDynamicMultiplier(200)).toBe(0.3);
  });

  it("closed market uses base price via multiplierOverride 0 even at 0% capacity", () => {
    const quiet = computeQuote({
      providerBasePrice: SPEC_PROVIDER_BASE,
      usedCapacityPct: 0,
      isHomeVisit: false,
    });
    expect(quiet.multiplier).toBeCloseTo(-0.3, 5);

    const closed = computeQuote({
      providerBasePrice: SPEC_PROVIDER_BASE,
      usedCapacityPct: 0,
      multiplierOverride: 0,
      isHomeVisit: false,
    });
    expect(closed.multiplier).toBe(0);
    expect(closed.customerServicePrice).toBe(375);
  });
});

describe("§2.2 commission — customer_price = provider_price / 0.80", () => {
  it("converts provider net to customer price via division", () => {
    expect(providerPriceToCustomerPrice(300)).toBe(375);
    expect(providerPriceToCustomerPrice(336)).toBe(420);
  });
});

describe("§2.1 trimmed-mean base price", () => {
  it("activates only after 5 provider submissions", () => {
    const five = computeTrimmedMeanBasePrice([400, 420, 440, 460, 480]);
    expect(five.isActive).toBe(true);
    expect(five.basePrice).toBe(440);

    const four = computeTrimmedMeanBasePrice([400, 420, 440, 460]);
    expect(four.isActive).toBe(false);
    expect(four.basePrice).toBe(430);
  });
});

describe("§2.4 delivery fee (home visits only)", () => {
  it("uses 150 + 10/km with a 160 kr floor for short trips", () => {
    expect(computeDeliveryFee(0, true)).toBe(160);
    expect(computeDeliveryFee(1, true)).toBe(160);
    expect(computeDeliveryFee(5, true)).toBe(200);
    expect(computeDeliveryFee(5, false)).toBe(0);
  });
});

describe("§2.6 worked example — Skin Fade, 70 % capacity, 5 km, beard trim", () => {
  it("splits customer, provider, and FreshUp totals per spec", () => {
    const quote = computeQuote({
      providerBasePrice: SPEC_PROVIDER_BASE,
      usedCapacityPct: 70,
      deliveryKm: 5,
      isHomeVisit: true,
      addons: [{ id: "beard_trim", customerPrice: 80 }],
    });

    expect(quote.multiplier).toBeCloseTo(0.12, 5);
    expect(quote.customerServicePrice).toBe(420);
    expect(quote.deliveryFee).toBe(200);
    expect(quote.addonsCustomerTotal).toBe(80);
    expect(quote.customerTotal).toBe(700);
    expect(quote.providerTotal).toBe(600);
    expect(quote.freshupTotal).toBe(100);
  });
});
