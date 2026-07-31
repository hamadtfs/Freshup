/**
 * Constants for the FreshUp Pricing & Tier System Specification v1.0.
 * Values come directly from the spec (sections 2.1 – 2.5).
 *
 * Currency: NOK (Norwegian kroner) — see existing orders.currency default.
 */

/** FreshUp commission rate applied to main service & add-ons (spec §2.2, §2.5). */
export const FRESHUP_COMMISSION_PCT = 0.20;

/** Provider keep ratio = 1 - commission. Customer price = provider_price / PROVIDER_KEEP_RATIO. */
export const PROVIDER_KEEP_RATIO = 1 - FRESHUP_COMMISSION_PCT; // 0.80

/** Trimmed-mean trim percentage for base-price aggregation (spec §2.1: top & bottom 10%). */
export const BASE_PRICE_TRIM_PCT = 0.10;

/** Minimum number of provider price submissions before a base price activates (spec §2.1). */
export const MIN_AREA_PROVIDERS = 5;

/** Dynamic pricing multiplier bounds (spec §2.3). */
export const DYNAMIC_MULTIPLIER_MIN = -0.30; // -30% (cap when capacity < 0%)
export const DYNAMIC_MULTIPLIER_MAX = 0.30; //  +30% (cap when capacity > 100%)

/**
 * Linear coefficients for `multiplier = a + (used_capacity / 100) * b`
 * From spec §2.3:
 *   - 0%   → -30%
 *   - 50%  →  0%
 *   - 100% → +30%
 *   ⇒ a = -0.30, b = 0.60
 */
export const DYNAMIC_MULTIPLIER_INTERCEPT = -0.30;
export const DYNAMIC_MULTIPLIER_SLOPE = 0.60;

/** Window used for `used_capacity` numerator (spec §2.3: active bookings in the last 30 minutes). */
export const USED_CAPACITY_WINDOW_MINUTES = 30;

/**
 * How often a service/area's used-capacity multiplier should be recomputed (spec §2.3).
 * The spec allows 5–10 minutes; we pick 5 to keep responsiveness while still avoiding jitter.
 */
export const DYNAMIC_RECALC_INTERVAL_MINUTES = 5;

/** Delivery-fee formula constants (spec §2.4: `150 + 10 * km`, min 160 kr through 1 km). */
export const DELIVERY_FEE_BASE = 150;
export const DELIVERY_FEE_PER_KM = 10;
/** Minimum home-delivery fee (0.1–1 km bills as 160 kr, not 150 kr base-only). */
export const DELIVERY_FEE_MIN = 160;

/**
 * How long a customer's quoted price remains locked after they begin a booking (spec §2.3:
 * "Once a customer starts a booking, lock the displayed price so it doesn't change mid-flow.").
 * The spec doesn't pin an explicit expiry, but 15 minutes is a safe upper bound for
 * a single booking flow.
 */
export const PRICE_LOCK_TTL_MINUTES = 15;

/** Default country code used when grouping providers into areas (spec §2.1: Norway). */
export const DEFAULT_COUNTRY = "NO";

/** Default currency code (spec uses "kr" = NOK). */
export const DEFAULT_CURRENCY = "NOK";
