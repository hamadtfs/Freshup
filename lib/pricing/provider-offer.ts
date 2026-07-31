/**
 * Provider-facing amounts for incoming offers and job UI.
 * Spec §2.2: customer pays the gross price; provider sees their net (80%);
 * FreshUp keeps the 20% commission on service and add-ons (not delivery).
 */

import { customerPriceToProviderPrice } from "./engine";

export type ProviderOfferPriceSlice = {
  provider_service_price?: number | null;
  customer_service_price?: number | null;
  addons_provider_total?: number | null;
  addons_customer_total?: number | null;
  delivery_fee?: number | null;
};

/** Provider net for a customer-facing line item (service or add-on). */
export function providerNetFromCustomerAmount(customerAmount: number): number {
  if (!Number.isFinite(customerAmount) || customerAmount <= 0) return 0;
  return Math.round(customerPriceToProviderPrice(customerAmount) * 100) / 100;
}

/** FreshUp commission on a customer-facing service or add-on line. */
export function freshupCommissionFromCustomerAmount(
  customerAmount: number,
): number {
  const customer = Number(customerAmount);
  if (!Number.isFinite(customer) || customer <= 0) return 0;
  const provider = providerNetFromCustomerAmount(customer);
  return Math.round((customer - provider) * 100) / 100;
}

export function resolveProviderServiceNet(
  lock: ProviderOfferPriceSlice | null | undefined,
  customerServiceFallback = 0,
): number {
  const explicit = Number(lock?.provider_service_price);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.round(explicit * 100) / 100;
  }
  const customer =
    Number(lock?.customer_service_price) || customerServiceFallback;
  return providerNetFromCustomerAmount(customer);
}

export function resolveProviderAddonsNet(
  lock: ProviderOfferPriceSlice | null | undefined,
  customerAddonsFallback = 0,
): number {
  const explicit = Number(lock?.addons_provider_total);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.round(explicit * 100) / 100;
  }
  const customer =
    Number(lock?.addons_customer_total) || customerAddonsFallback;
  return providerNetFromCustomerAmount(customer);
}

export function resolveProviderOfferEarnings(opts: {
  providerServicePrice?: number | null;
  customerServicePrice?: number | null;
  addonsProviderTotal?: number | null;
  addonsCustomerTotal?: number | null;
  deliveryFee?: number | null;
  mode?: "home" | "provider" | null;
}): number {
  let serviceNet = Number(opts.providerServicePrice);
  if (!Number.isFinite(serviceNet) || serviceNet <= 0) {
    serviceNet = resolveProviderServiceNet(
      {
        customer_service_price: opts.customerServicePrice,
      },
      Number(opts.customerServicePrice) || 0,
    );
  }

  let addonsNet = Number(opts.addonsProviderTotal);
  if (!Number.isFinite(addonsNet) || addonsNet <= 0) {
    addonsNet = resolveProviderAddonsNet(
      {
        addons_customer_total: opts.addonsCustomerTotal,
      },
      Number(opts.addonsCustomerTotal) || 0,
    );
  }

  const delivery =
    opts.mode === "home"
      ? Math.round(Number(opts.deliveryFee) || 0)
      : 0;

  return Math.round((serviceNet + addonsNet + delivery) * 100) / 100;
}
