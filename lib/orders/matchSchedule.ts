/**
 * Pure helpers for “available at requested time” — used by matchProviders (no UI).
 */

export function intervalsOverlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}

export type CommittedOrderRow = {
  provider_id: string | null
  service_id: string
  scheduled_at: string | null
  started_at: string | null
  accepted_at: string | null
  created_at: string | null
}

/** Time window for an assigned / en_route / in_progress job. */
export function committedOrderWindowMs(
  order: CommittedOrderRow,
  durationByServiceId: Map<string, number>,
): { start: number; end: number } | null {
  const durMin = durationByServiceId.get(order.service_id) ?? 60
  const durMs = durMin * 60_000

  if (order.scheduled_at) {
    const s = new Date(order.scheduled_at).getTime()
    if (!Number.isFinite(s)) return null
    return { start: s, end: s + durMs }
  }

  const anchorStr = order.started_at || order.accepted_at || order.created_at
  if (!anchorStr) return null
  const s = new Date(anchorStr).getTime()
  if (!Number.isFinite(s)) return null
  return { start: s, end: s + durMs }
}

export function buildBusyProviderIdsForMatching(args: {
  committedOrders: CommittedOrderRow[]
  /** Requested slot start (ISO parsed). Only used when hasScheduledRequest is true. */
  requestStartMs: number
  requestEndMs: number
  hasScheduledRequest: boolean
  durationByServiceId: Map<string, number>
}): Set<string> {
  const busy = new Set<string>()
  const { committedOrders, requestStartMs, requestEndMs, hasScheduledRequest, durationByServiceId } = args

  if (!hasScheduledRequest) {
    for (const o of committedOrders) {
      if (o.provider_id) busy.add(o.provider_id)
    }
    return busy
  }

  if (!Number.isFinite(requestStartMs) || !Number.isFinite(requestEndMs)) {
    for (const o of committedOrders) {
      if (o.provider_id) busy.add(o.provider_id)
    }
    return busy
  }

  for (const o of committedOrders) {
    if (!o.provider_id) continue
    const w = committedOrderWindowMs(o, durationByServiceId)
    if (w && intervalsOverlapMs(requestStartMs, requestEndMs, w.start, w.end)) {
      busy.add(o.provider_id)
    }
  }
  return busy
}
