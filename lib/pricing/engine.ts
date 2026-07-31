/**
 * Pure pricing engine — implementation of FreshUp Pricing & Tier System
 * Specification v1.0 sections 2.1 – 2.5.
 *
 * Every function here is deterministic and side-effect-free. Database I/O
 * lives in the API routes that call into this module.
 *
 * Conventions used throughout:
 *   - `provider_price`  → what a provider quoted / what they earn (spec §2.1, §2.2)
 *   - `customer_price`  → what the customer sees & pays
 *                         customer_price = provider_price / PROVIDER_KEEP_RATIO
 *                         (spec §2.2: division by 0.80, *not* multiplication by 1.20)
 *   - `delivery_fee`    → 100 % to the provider (spec §2.4)
 *   - All amounts are in NOK; rounding follows øre precision (2 decimals).
 */

import {
  BASE_PRICE_TRIM_PCT,
  DELIVERY_FEE_BASE,
  DELIVERY_FEE_MIN,
  DELIVERY_FEE_PER_KM,
  DYNAMIC_MULTIPLIER_INTERCEPT,
  DYNAMIC_MULTIPLIER_MAX,
  DYNAMIC_MULTIPLIER_MIN,
  DYNAMIC_MULTIPLIER_SLOPE,
  FRESHUP_COMMISSION_PCT,
  MIN_AREA_PROVIDERS,
  PROVIDER_KEEP_RATIO,
} from "./constants";

// ---------------------------------------------------------------------------
// §2.1 — Base price aggregation
// ---------------------------------------------------------------------------

export interface TrimmedMeanResult {
  /** Number of submissions used (after trimming). */
  usedSamples: number;
  /** Number of submissions before trimming. */
  totalSamples: number;
  /** Trimmed-mean price, or `null` if too few inputs to trust. */
  basePrice: number | null;
  /** True once the spec's minimum threshold is met (default: 5 providers). */
  isActive: boolean;
}

/**
 * Compute a trimmed-mean base price (spec §2.1):
 *   1. Drop the top `trimPct` and bottom `trimPct` of inputs as outliers.
 *   2. Average the remainder.
 *   3. Mark the result *active* only when ≥ `minSamples` raw inputs exist.
 *
 * This protects against one rogue provider entering 1000 kr (spec example).
 *
 * Edge cases:
 *   - 0 inputs            → basePrice = null, isActive = false.
 *   - < minSamples inputs → basePrice = trimmedMean (for preview), but isActive = false.
 *   - Negative or NaN     → silently ignored.
 */
export function computeTrimmedMeanBasePrice(
  rawPrices: ReadonlyArray<number>,
  options: { trimPct?: number; minSamples?: number } = {},
): TrimmedMeanResult {
  const trimPct = options.trimPct ?? BASE_PRICE_TRIM_PCT;
  const minSamples = options.minSamples ?? MIN_AREA_PROVIDERS;

  const cleaned = (rawPrices ?? [])
    .map((p) => Number(p))
    .filter((p) => Number.isFinite(p) && p > 0)
    .sort((a, b) => a - b);

  const total = cleaned.length;
  if (total === 0) {
    return { usedSamples: 0, totalSamples: 0, basePrice: null, isActive: false };
  }

  // Drop ⌊trimPct × n⌋ from each end. For very small samples this can
  // collapse to the full set, which is fine for preview / debugging.
  const trimCount = Math.floor(total * trimPct);
  const trimmed = cleaned.slice(trimCount, total - trimCount);
  const denom = trimmed.length || cleaned.length;
  const sample = trimmed.length > 0 ? trimmed : cleaned;
  const mean = sample.reduce((sum, p) => sum + p, 0) / denom;

  return {
    usedSamples: sample.length,
    totalSamples: total,
    basePrice: roundToOre(mean),
    isActive: total >= minSamples,
  };
}

// ---------------------------------------------------------------------------
// §2.2 — FreshUp commission (provider price → customer price)
// ---------------------------------------------------------------------------

/**
 * Convert a provider-side price to the customer-facing price.
 *
 * Spec §2.2: customer_price = provider_price / 0.80
 *
 * The naïve `provider_price * 1.20` is wrong: 300 × 1.20 = 360, but a customer
 * paying 360 leaves the provider with only 360 × 0.80 = 288 after the 20 %
 * cut, not the original 300. Division by 0.80 is the only correct formula.
 */
export function providerPriceToCustomerPrice(
  providerPrice: number,
  commissionPct: number = FRESHUP_COMMISSION_PCT,
): number {
  if (!Number.isFinite(providerPrice) || providerPrice <= 0) return 0;
  const keep = 1 - commissionPct;
  if (keep <= 0) return 0;
  return roundToOre(providerPrice / keep);
}

/** Inverse of {@link providerPriceToCustomerPrice}; useful when admins quote a customer price. */
export function customerPriceToProviderPrice(
  customerPrice: number,
  commissionPct: number = FRESHUP_COMMISSION_PCT,
): number {
  if (!Number.isFinite(customerPrice) || customerPrice <= 0) return 0;
  return roundToOre(customerPrice * (1 - commissionPct));
}

/** FreshUp's share = customer_price - provider_price. */
export function freshupShareFromCustomerPrice(
  customerPrice: number,
  commissionPct: number = FRESHUP_COMMISSION_PCT,
): number {
  if (!Number.isFinite(customerPrice) || customerPrice <= 0) return 0;
  return roundToOre(customerPrice * commissionPct);
}

// ---------------------------------------------------------------------------
// §2.3 — Dynamic pricing (used capacity → multiplier)
// ---------------------------------------------------------------------------

/**
 * Compute used_capacity per spec §2.3:
 *
 *   used_capacity = (active_bookings_last_30min / online_providers) × 100 %
 *
 * - When `onlineProviders` is 0 and there are no bookings → 0 (quiet market).
 * - When `onlineProviders` is 0 but bookings > 0 → treat as fully saturated
 *   (no local supply for existing demand), not "quiet".
 * - The result is a *percentage* (0 – 100+), not a 0–1 ratio.
 */
export function computeUsedCapacity(
  activeBookingsLast30Min: number,
  onlineProviders: number,
): number {
  const a = Math.max(0, Number(activeBookingsLast30Min) || 0);
  const p = Math.max(0, Number(onlineProviders) || 0);
  if (p === 0) return a > 0 ? Math.max(100, a * 100) : 0;
  return (a / p) * 100;
}

/**
 * Linear price multiplier for a given used_capacity percentage (spec §2.3):
 *
 *   multiplier = -0.30 + (used_capacity / 100) * 0.60
 *
 * Capped at -30 % below 0 % capacity and +30 % above 100 % capacity.
 *
 * Sample table (matches the spec exactly when applied to base 375 kr):
 *
 *   |  cap |   mult  |
 *   |   0% | -30.00% |
 *   |  20% | -18.00% |
 *   |  30% | -12.00% |
 *   |  50% |   0.00% |
 *   |  70% | +12.00% |
 *   |  80% | +18.00% |
 *   | 100% | +30.00% |
 */
export function computeDynamicMultiplier(usedCapacityPct: number): number {
  const raw =
    DYNAMIC_MULTIPLIER_INTERCEPT +
    (Number(usedCapacityPct) / 100) * DYNAMIC_MULTIPLIER_SLOPE;
  if (!Number.isFinite(raw)) return 0;
  return clamp(raw, DYNAMIC_MULTIPLIER_MIN, DYNAMIC_MULTIPLIER_MAX);
}

/**
 * Apply a dynamic multiplier to a provider base price.
 *
 *   adjusted_provider_price = base_provider_price * (1 + multiplier)
 *
 * This is the price the provider sees in the request before commission.
 */
export function applyDynamicMultiplier(
  baseProviderPrice: number,
  multiplier: number,
): number {
  if (!Number.isFinite(baseProviderPrice) || baseProviderPrice <= 0) return 0;
  const m = Number.isFinite(multiplier) ? multiplier : 0;
  return roundToOre(baseProviderPrice * (1 + m));
}

// ---------------------------------------------------------------------------
// §2.4 — Delivery fee (home visits only)
// ---------------------------------------------------------------------------

/**
 * Universal delivery-fee formula (spec §2.4):
 *
 *   delivery_fee = max(160, 150 kr base + 10 kr per km)
 *
 * Short trips (0.1–1 km) bill at least 160 kr; above 1 km grows by 10 kr/km
 * (e.g. 2 km → 170 kr, 6 km → 210 kr).
 *
 * Returns 0 when the customer chose "at-provider" (km = 0 or not a home visit).
 * 100 % of this fee goes to the provider — FreshUp does **not** take commission
 * on delivery, because it compensates the provider for actual driving.
 *
 * @param kilometres straight-line distance from provider → customer (km)
 * @param isHomeVisit pass `false` for at-provider service (customer comes to provider)
 */
export function computeDeliveryFee(
  kilometres: number,
  isHomeVisit: boolean = true,
): number {
  if (!isHomeVisit) return 0;
  const km = Math.max(0, Number(kilometres) || 0);
  const linear = DELIVERY_FEE_BASE + DELIVERY_FEE_PER_KM * km;
  return roundToOre(Math.max(DELIVERY_FEE_MIN, linear));
}

// ---------------------------------------------------------------------------
// §2.5 — Add-ons (composition)
// ---------------------------------------------------------------------------

export interface AddonInput {
  id: string;
  name?: string;
  /** Customer-facing add-on price (already includes the 20 % FreshUp share). */
  customerPrice: number;
  /** Optional explicit provider share; defaults to customerPrice * 0.80. */
  providerShare?: number;
}

export interface AddonComputed extends AddonInput {
  providerShare: number;
  freshupShare: number;
}

export function computeAddon(addon: AddonInput): AddonComputed {
  const customerPrice = Math.max(0, Number(addon.customerPrice) || 0);
  const providerShare =
    Number.isFinite(addon.providerShare) && (addon.providerShare ?? 0) > 0
      ? roundToOre(addon.providerShare!)
      : customerPriceToProviderPrice(customerPrice);
  return {
    ...addon,
    customerPrice: roundToOre(customerPrice),
    providerShare,
    freshupShare: roundToOre(customerPrice - providerShare),
  };
}

// ---------------------------------------------------------------------------
// Public quote — composition of §2.1 – §2.5
// ---------------------------------------------------------------------------

export interface QuoteInput {
  /** Provider-side base price for the service in this area (output of §2.1). */
  providerBasePrice: number;
  /** Used-capacity percentage for this service / area at quote time (§2.3). */
  usedCapacityPct?: number;
  /** Pre-computed multiplier; if provided, overrides `usedCapacityPct`. */
  multiplierOverride?: number;
  /** Distance from provider to customer in km (§2.4); ignored when `isHomeVisit = false`. */
  deliveryKm?: number;
  /** True for a home visit (customer at home), false for at-provider service. */
  isHomeVisit?: boolean;
  /** Optional add-ons selected by the customer (§2.5). */
  addons?: ReadonlyArray<AddonInput>;
}

export interface QuoteBreakdown {
  /** Provider-side raw base before multiplier (kept for transparency). */
  providerBasePrice: number;
  /** Multiplier actually applied (∈ [-0.30, 0.30]). */
  multiplier: number;
  /** Used capacity percentage that produced the multiplier (echoed input). */
  usedCapacityPct: number;
  /** Provider-side service price after multiplier (no commission, no delivery). */
  providerServicePrice: number;
  /** Customer-side service price after multiplier and 20 % commission. */
  customerServicePrice: number;
  /** Delivery fee (0 if not a home visit). 100 % goes to provider. */
  deliveryFee: number;
  /** Computed add-ons (each with provider/freshup shares). */
  addons: AddonComputed[];
  /** Total customer-facing add-ons price. */
  addonsCustomerTotal: number;
  /** Total provider-side add-ons price. */
  addonsProviderTotal: number;
  /** Grand total the customer pays. */
  customerTotal: number;
  /** Total earnings the provider receives (service + delivery + add-on shares). */
  providerTotal: number;
  /** FreshUp's net cut (commission on service + add-ons; nothing from delivery). */
  freshupTotal: number;
}

/**
 * Compose the entire quote per spec §2.1 – §2.5.
 * All amounts returned in NOK rounded to øre.
 */
export function computeQuote(input: QuoteInput): QuoteBreakdown {
  const providerBasePrice = Math.max(0, Number(input.providerBasePrice) || 0);
  const usedCapacityPct = Math.max(0, Number(input.usedCapacityPct ?? 0));

  const multiplier = clamp(
    input.multiplierOverride ?? computeDynamicMultiplier(usedCapacityPct),
    DYNAMIC_MULTIPLIER_MIN,
    DYNAMIC_MULTIPLIER_MAX,
  );

  const providerServicePrice = applyDynamicMultiplier(providerBasePrice, multiplier);
  const customerServicePrice = providerPriceToCustomerPrice(providerServicePrice);

  const deliveryFee = computeDeliveryFee(
    input.deliveryKm ?? 0,
    input.isHomeVisit !== false,
  );

  const addons = (input.addons ?? []).map(computeAddon);
  const addonsCustomerTotal = roundToOre(
    addons.reduce((sum, a) => sum + a.customerPrice, 0),
  );
  const addonsProviderTotal = roundToOre(
    addons.reduce((sum, a) => sum + a.providerShare, 0),
  );

  const customerTotal = roundToOre(
    customerServicePrice + deliveryFee + addonsCustomerTotal,
  );
  const providerTotal = roundToOre(
    providerServicePrice + deliveryFee + addonsProviderTotal,
  );
  const freshupTotal = roundToOre(customerTotal - providerTotal);

  return {
    providerBasePrice: roundToOre(providerBasePrice),
    multiplier,
    usedCapacityPct,
    providerServicePrice,
    customerServicePrice,
    deliveryFee,
    addons,
    addonsCustomerTotal,
    addonsProviderTotal,
    customerTotal,
    providerTotal,
    freshupTotal,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Round to two decimal places (øre).
 * We intentionally avoid `toFixed` to keep the result a number, not a string.
 */
function roundToOre(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}
