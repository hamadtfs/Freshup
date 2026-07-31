/**
 * Demand zone display tiers from used_capacity % (same metric as dynamic pricing).
 * Customer vs provider colors are inverted at read time.
 */

export type DemandZoneTier = "green" | "blue" | "red";
export type DemandZoneAudience = "customer" | "provider";

/** Low / mid / high capacity bands (percent). */
export const TIER_LOW_MAX = 35;
export const TIER_HIGH_MIN = 65;

export function capacityPctToTier(usedCapacityPct: number): DemandZoneTier {
  const pct = Number(usedCapacityPct);
  if (!Number.isFinite(pct) || pct < TIER_LOW_MAX) return "green";
  if (pct >= TIER_HIGH_MIN) return "red";
  return "blue";
}

export function tierForAudience(
  usedCapacityPct: number,
  audience: DemandZoneAudience,
): DemandZoneTier {
  const base = capacityPctToTier(usedCapacityPct);
  if (audience === "provider") {
    if (base === "green") return "red";
    if (base === "red") return "green";
  }
  return base;
}

const LABELS: Record<
  DemandZoneAudience,
  Record<DemandZoneTier, { en: string; no: string }>
> = {
  customer: {
    green: {
      en: "Many available — lower prices",
      no: "Mange tilgjengelige — lavere priser",
    },
    blue: {
      en: "Normal availability",
      no: "Normal tilgjengelighet",
    },
    red: {
      en: "Few available — higher prices, longer wait",
      no: "Fa tilgjengelige — hoyere priser, lengre ventetid",
    },
  },
  provider: {
    green: {
      en: "High demand — head this way",
      no: "Hoy etterspørsel — dra hit",
    },
    blue: {
      en: "Normal demand",
      no: "Normal etterspørsel",
    },
    red: {
      en: "Low demand",
      no: "Lav etterspørsel",
    },
  },
};

export function tierLabel(
  tier: DemandZoneTier,
  audience: DemandZoneAudience,
  language: "en" | "no" = "no",
): string {
  return LABELS[audience][tier][language];
}

/** Compact label for service cards (Opptatt status). */
const SHORT_LABELS: Record<
  DemandZoneAudience,
  Record<DemandZoneTier, { en: string; no: string }>
> = {
  customer: {
    green: { en: "Many available", no: "Mange ledige" },
    blue: { en: "Normal", no: "Normal" },
    red: { en: "Almost full", no: "Nesten full" },
  },
  provider: {
    green: { en: "High demand", no: "Hoy etterspørsel" },
    blue: { en: "Normal demand", no: "Normal etterspørsel" },
    red: { en: "Low demand", no: "Lav etterspørsel" },
  },
};

export function tierShortLabel(
  tier: DemandZoneTier,
  audience: DemandZoneAudience,
  language: "en" | "no" = "no",
): string {
  return SHORT_LABELS[audience][tier][language];
}

/** Price direction indicator beside the card price. */
export function tierPriceArrow(tier: DemandZoneTier): string {
  switch (tier) {
    case "red":
      return "▲";
    case "green":
      return "▼";
    default:
      return "•";
  }
}

export function tierTextClass(tier: DemandZoneTier): string {
  switch (tier) {
    case "green":
      return "text-green-600";
    case "red":
      return "text-red-600";
    default:
      return "text-blue-600";
  }
}
