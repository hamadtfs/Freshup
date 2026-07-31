/** Fallback when service duration is missing (half of 30 min → 15 min wait). */
export const DEFAULT_SERVICE_DURATION_MINUTES = 30;

/** Floor so zero/unknown durations do not unlock instantly. */
export const READY_FOR_NEXT_MIN_WAIT_MS = 15 * 1000;

export function normalizeServiceDurationMinutes(
  durationMinutes: number | null | undefined,
): number {
  const n = Number(durationMinutes);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SERVICE_DURATION_MINUTES;
  return n;
}

/** Wait until halfway through the service (per `services.duration_minutes`). */
export function readyForNextWaitMs(
  durationMinutes?: number | null,
): number {
  const mins = normalizeServiceDurationMinutes(durationMinutes);
  const halfMs = (mins * 60 * 1000) / 2;
  return Math.max(READY_FOR_NEXT_MIN_WAIT_MS, halfMs);
}

export function readyForNextUnlockAtMs(
  serviceStartedAtIso: string | null | undefined,
  durationMinutes?: number | null,
): number | null {
  if (!serviceStartedAtIso) return null;
  const started = new Date(serviceStartedAtIso).getTime();
  if (!Number.isFinite(started)) return null;
  return started + readyForNextWaitMs(durationMinutes);
}

export function readyForNextRemainingMs(
  serviceStartedAtIso: string | null | undefined,
  durationMinutes?: number | null,
  nowMs = Date.now(),
): number {
  const unlockAt = readyForNextUnlockAtMs(
    serviceStartedAtIso,
    durationMinutes,
  );
  if (unlockAt == null) {
    return readyForNextWaitMs(durationMinutes);
  }
  return Math.max(0, unlockAt - nowMs);
}

export function isReadyForNextUnlocked(
  serviceStartedAtIso: string | null | undefined,
  durationMinutes?: number | null,
  nowMs = Date.now(),
): boolean {
  return (
    readyForNextRemainingMs(serviceStartedAtIso, durationMinutes, nowMs) <=
    0
  );
}

export function formatMmSs(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}
