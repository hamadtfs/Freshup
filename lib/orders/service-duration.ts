/** Elapsed in-service minutes (excludes paused time). */
export function computeActualServiceDurationMinutes(order: {
  started_at?: string | null;
  completed_at?: string | null;
  service_paused_total_seconds?: number | null;
}): number | null {
  if (!order.started_at || !order.completed_at) return null;
  const startMs = new Date(order.started_at).getTime();
  const endMs = new Date(order.completed_at).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null;
  }
  const pausedMs =
    Math.max(0, Number(order.service_paused_total_seconds) || 0) * 1000;
  return Math.max(1, Math.round((endMs - startMs - pausedMs) / 60_000));
}
