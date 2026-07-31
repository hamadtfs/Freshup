/**
 * Dispatch timing (customer-facing rules):
 * - Each distance/rating batch: Gold at +0s, Silver at +3s, Bronze at +6s.
 * - Next batch opens 10s after the previous batch started (Batch 1 at t=0).
 * - Wave 0 (Batch 1 · Gold) runs on book confirm — no wait for cron.
 * - A provider keeps a 60s window from when their offer row is inserted (per wave).
 * - Cron must wake dispatch roughly every DISPATCH_TIER_GAP_MS so waves do not bunch.
 */
export const DISPATCH_BATCH_OPEN_MS = 10_000;
export const DISPATCH_TIER_GAP_MS = 3_000;
export const DISPATCH_TIERS_PER_BATCH = 3;
export const DISPATCH_PROVIDER_OFFER_TTL_MS = 60_000;
export const DISPATCH_BATCH_COUNT = 6;

/** Milliseconds after dispatch_started_at when wave `stepIndex` may fire (batch 1: 0 / 3 / 6 s). */
export function dispatchStepDelayMs(stepIndex: number): number {
  const batchIndex = Math.floor(stepIndex / DISPATCH_TIERS_PER_BATCH);
  const tierIndex = stepIndex % DISPATCH_TIERS_PER_BATCH;
  return batchIndex * DISPATCH_BATCH_OPEN_MS + tierIndex * DISPATCH_TIER_GAP_MS;
}

/** Last wave start offset from dispatch_started_at (Batch 6 · Bronze). */
export const DISPATCH_LAST_WAVE_DELAY_MS =
  (DISPATCH_BATCH_COUNT - 1) * DISPATCH_BATCH_OPEN_MS +
  (DISPATCH_TIERS_PER_BATCH - 1) * DISPATCH_TIER_GAP_MS;

/** Providers considered per sub-wave after RPC match. */
export const DISPATCH_MATCHES_PER_WAVE = 15;
