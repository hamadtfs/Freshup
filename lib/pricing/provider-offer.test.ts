import { describe, expect, it } from "vitest";
import {
  freshupCommissionFromCustomerAmount,
  providerNetFromCustomerAmount,
  resolveProviderOfferEarnings,
} from "./provider-offer";

describe("customer vs provider price split (spec §2.2)", () => {
  it("splits 350 kr customer service into 280 provider + 70 FreshUp", () => {
    expect(providerNetFromCustomerAmount(350)).toBe(280);
    expect(freshupCommissionFromCustomerAmount(350)).toBe(70);
  });

  it("totals provider earnings for at-provider service only", () => {
    expect(
      resolveProviderOfferEarnings({
        customerServicePrice: 350,
        mode: "provider",
      }),
    ).toBe(280);
  });

  it("includes full delivery fee in provider earnings (0% commission)", () => {
    expect(
      resolveProviderOfferEarnings({
        customerServicePrice: 420,
        addonsCustomerTotal: 80,
        deliveryFee: 200,
        mode: "home",
      }),
    ).toBe(600);
  });
});
