/**
 * Pricing & Tier System spec §3 — all metrics use denominator "received" (offers sent).
 * score = (accept_rate + completion_rate + response_speed) / 3
 */

export type ProviderPerformanceTier = "gold" | "silver" | "bronze";

export type PerformanceOfferRow = {
  status: string;
  created_at: string;
  responded_at?: string | null;
  /** Seconds from when the provider saw the offer (preferred) or from create. */
  response_time_seconds?: number | null;
};

export type ResponseSpeedBucketKey =
  | "within3s"
  | "within6s"
  | "within9s"
  | "after9s"
  | "noResponse";

export type ResponseSpeedBuckets = {
  within3s: number;
  within6s: number;
  within9s: number;
  after9s: number;
  noResponse: number;
  acceptedWithin3s: number;
  acceptedWithin6s: number;
  acceptedWithin9s: number;
  acceptedAfter9s: number;
  totalPoints: number;
};

export type ProviderPerformanceResult = {
  received: number;
  accepted: number;
  completed: number;
  acceptRate: number;
  completionRate: number;
  responseSpeed: number;
  /** Null when fewer than PERFORMANCE_MIN_RECEIVED_SAMPLE offers (tier is starter Silver). */
  score: number | null;
  tier: ProviderPerformanceTier;
  /** True when tier is starter Silver — not derived from score yet (§3.4). */
  tierIsProvisional: boolean;
  responseBuckets: ResponseSpeedBuckets;
};

const EMPTY_BUCKETS: ResponseSpeedBuckets = {
  within3s: 0,
  within6s: 0,
  within9s: 0,
  after9s: 0,
  noResponse: 0,
  acceptedWithin3s: 0,
  acceptedWithin6s: 0,
  acceptedWithin9s: 0,
  acceptedAfter9s: 0,
  totalPoints: 0,
};

/** Wave-aligned response points (Gold 3s / Silver 6s / Bronze 9s). */
export function responseSpeedPointsFromSeconds(
  seconds: number | null | undefined,
): number {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return 0;
  if (seconds <= 3) return 1;
  if (seconds <= 6) return 0.5;
  if (seconds <= 9) return 0.25;
  return 0;
}

export function responseSecondsForOffer(
  row: PerformanceOfferRow,
): number | null {
  const stored = Number(row.response_time_seconds);
  if (Number.isFinite(stored) && stored >= 0) return stored;

  const createdMs = new Date(String(row.created_at)).getTime();
  const respondedMs = row.responded_at
    ? new Date(String(row.responded_at)).getTime()
    : NaN;
  if (!Number.isFinite(createdMs) || !Number.isFinite(respondedMs)) {
    return null;
  }
  return Math.max(0, (respondedMs - createdMs) / 1000);
}

export function classifyResponseBucket(
  row: PerformanceOfferRow,
): ResponseSpeedBucketKey {
  const sec = responseSecondsForOffer(row);
  if (sec == null) return "noResponse";
  if (sec <= 3) return "within3s";
  if (sec <= 6) return "within6s";
  if (sec <= 9) return "within9s";
  return "after9s";
}

function accumulateResponseBuckets(
  offers: PerformanceOfferRow[],
): { buckets: ResponseSpeedBuckets; speedPoints: number } {
  const buckets: ResponseSpeedBuckets = { ...EMPTY_BUCKETS };
  let speedPoints = 0;

  for (const row of offers) {
    const bucket = classifyResponseBucket(row);
    const isAccepted =
      String(row.status || "").toLowerCase() === "accepted";

    buckets[bucket] += 1;
    if (isAccepted) {
      if (bucket === "within3s") buckets.acceptedWithin3s += 1;
      else if (bucket === "within6s") buckets.acceptedWithin6s += 1;
      else if (bucket === "within9s") buckets.acceptedWithin9s += 1;
      else if (bucket === "after9s") buckets.acceptedAfter9s += 1;
    }

    if (bucket !== "noResponse") {
      const sec = responseSecondsForOffer(row);
      speedPoints += responseSpeedPointsFromSeconds(sec);
    }
  }

  buckets.totalPoints = speedPoints;
  return { buckets, speedPoints };
}

export function tierForPerformanceScore(scorePercent: number): ProviderPerformanceTier {
  if (scorePercent >= 70) return "gold";
  if (scorePercent >= 50) return "silver";
  return "bronze";
}

/** Minimum offers in window before tier is scored (below → starter Silver per §3.4). */
export const PERFORMANCE_MIN_RECEIVED_SAMPLE = 3;

export const PERFORMANCE_ROLLING_DAYS = 30;

/** §3.4 — new providers cannot drop below Silver during this window. */
export const NEW_PROVIDER_GRACE_DAYS = 30;

export const NEW_PROVIDER_START_TIER: ProviderPerformanceTier = "silver";

export function isWithinNewProviderGrace(
  providerCreatedAt: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!providerCreatedAt) return false;
  const createdMs = new Date(providerCreatedAt).getTime();
  if (!Number.isFinite(createdMs)) return false;
  return nowMs - createdMs < NEW_PROVIDER_GRACE_DAYS * 24 * 60 * 60 * 1000;
}

/** Floor Bronze → Silver while inside the §3.4 grace window. */
export function applyNewProviderTierFloor(
  rawTier: ProviderPerformanceTier,
  providerCreatedAt: string | null | undefined,
  nowMs: number = Date.now(),
): ProviderPerformanceTier {
  if (
    rawTier === "bronze" &&
    isWithinNewProviderGrace(providerCreatedAt, nowMs)
  ) {
    return "silver";
  }
  return rawTier;
}

export function computeProviderPerformance(params: {
  offers: PerformanceOfferRow[];
  completedJobs: number;
  providerCreatedAt?: string | null;
}): ProviderPerformanceResult {
  const received = params.offers.length;
  const accepted = params.offers.filter(
    (o) => String(o.status || "").toLowerCase() === "accepted",
  ).length;
  const completed = Math.max(0, params.completedJobs);

  const { buckets, speedPoints } = accumulateResponseBuckets(params.offers);

  if (received < PERFORMANCE_MIN_RECEIVED_SAMPLE) {
    return {
      received,
      accepted,
      completed,
      acceptRate: 0,
      completionRate: 0,
      responseSpeed: 0,
      score: null,
      tier: NEW_PROVIDER_START_TIER,
      tierIsProvisional: true,
      responseBuckets: buckets,
    };
  }

  const acceptRateNorm = accepted / received;
  const completionRateNorm = completed / received;
  const responseSpeedNorm = speedPoints / received;
  const scoreNorm =
    (acceptRateNorm + completionRateNorm + responseSpeedNorm) / 3;
  const score = Math.round(scoreNorm * 100);
  const rawTier = tierForPerformanceScore(score);
  const tier = applyNewProviderTierFloor(
    rawTier,
    params.providerCreatedAt ?? null,
  );

  return {
    received,
    accepted,
    completed,
    acceptRate: Math.round(acceptRateNorm * 100),
    completionRate: Math.round(completionRateNorm * 100),
    responseSpeed: Math.round(responseSpeedNorm * 100),
    score,
    tier,
    tierIsProvisional: false,
    responseBuckets: buckets,
  };
}
