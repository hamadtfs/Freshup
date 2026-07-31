/** Elapsed active service seconds, excluding accumulated pause time. */
export function computeServiceElapsedSeconds(
  startedAtIso: string | null | undefined,
  pausedAtIso: string | null | undefined,
  pausedTotalSeconds: number | null | undefined,
  nowMs: number,
): number {
  if (!startedAtIso) return 0;
  const started = new Date(startedAtIso).getTime();
  if (!Number.isFinite(started)) return 0;

  const pausedTotalMs = Math.max(0, Number(pausedTotalSeconds) || 0) * 1000;

  if (pausedAtIso) {
    const pausedAt = new Date(pausedAtIso).getTime();
    if (Number.isFinite(pausedAt)) {
      return Math.max(
        0,
        Math.floor((pausedAt - started - pausedTotalMs) / 1000),
      );
    }
  }

  return Math.max(0, Math.floor((nowMs - started - pausedTotalMs) / 1000));
}
