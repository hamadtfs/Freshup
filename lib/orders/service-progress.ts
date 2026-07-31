/** Customer service bar: elapsed time vs scheduled duration (server `started_at`). */
export function computeServiceProgressPercent(
  startedAtIso: string | null | undefined,
  durationMinutes: number,
  nowMs = Date.now(),
): number {
  if (!startedAtIso) return 0;
  const started = new Date(startedAtIso).getTime();
  if (!Number.isFinite(started)) return 0;

  const durationMs = Math.max(5, Number(durationMinutes) || 30) * 60 * 1000;
  const elapsed = Math.max(0, nowMs - started);
  const pct = Math.round((elapsed / durationMs) * 100);
  return Math.min(95, Math.max(0, pct));
}
