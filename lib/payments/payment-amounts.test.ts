import { describe, expect, it } from "vitest";
import { MAX_DISPATCH_MATCH_RADIUS_KM } from "../orders/dispatch-radius";
import { maxDeliveryFeeAtDispatchRadius } from "./delivery-ceiling";
import {
  authorizeAmountFromPriceLock,
  captureAmountFromPriceLock,
} from "./payment-amounts";

describe("delivery ceiling tied to dispatch radius", () => {
  it("uses max dispatch radius (10 km) by default", () => {
    expect(MAX_DISPATCH_MATCH_RADIUS_KM).toBe(10);
    expect(maxDeliveryFeeAtDispatchRadius()).toBe(250);
    expect(maxDeliveryFeeAtDispatchRadius(10)).toBe(250);
  });

  it("scales when dispatch radius changes", () => {
    expect(maxDeliveryFeeAtDispatchRadius(6)).toBe(210);
  });
});

describe("payment authorize / capture amounts", () => {
  const homeLock = {
    delivery_mode: "home",
    customer_service_price: 350,
    addons_customer_total: 50,
    customer_total: 510,
    delivery_fee: 160,
  };

  it("authorizes service + addons + delivery ceiling for home", () => {
    expect(authorizeAmountFromPriceLock(homeLock)).toBe(650);
  });

  it("captures exact delivery at match without exceeding authorize", () => {
    const exact = captureAmountFromPriceLock(homeLock, 6);
    expect(exact).toBe(610);
    expect(exact).toBeLessThan(authorizeAmountFromPriceLock(homeLock));
  });

  it("uses locked total for at-provider bookings", () => {
    const lock = {
      delivery_mode: "provider",
      customer_service_price: 350,
      addons_customer_total: 0,
      customer_total: 350,
    };
    expect(authorizeAmountFromPriceLock(lock)).toBe(350);
    expect(captureAmountFromPriceLock(lock, null, 350)).toBe(350);
  });
});
