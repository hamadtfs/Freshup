import { createAdminClient } from "@/lib/supabase/server"
import {
  normalizeServiceDurationMinutes,
  readyForNextRemainingMs,
} from "@/lib/orders/readyForNext"
import { NextRequest, NextResponse } from "next/server"

/**
 * POST /api/orders/[id]/ready-for-next
 *
 * Provider opt-in mid-job availability. The assigned provider taps a
 * "Ready for next request" button while the current job is still in
 * progress; this endpoint stamps `orders.ready_for_next_at = now()` so
 * `match_providers` stops excluding them.
 *
 * Idempotent: subsequent calls re-stamp the timestamp but do not error.
 *
 * Body:
 *   { provider_id: string }
 *
 * Status codes:
 *   200 — success, returns { success, order_id, ready_for_next_at }
 *   400 — missing fields / order not in an in-progress state
 *   403 — provider does not own this order
 *   404 — order not found
 *   500 — DB error
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: orderId } = await params
    if (!orderId) {
      return NextResponse.json({ error: "Missing order id" }, { status: 400 })
    }

    let body: any = {}
    try {
      body = await req.json()
    } catch {
      body = {}
    }
    const providerId = String(body?.provider_id ?? "").trim()
    if (!providerId) {
      return NextResponse.json(
        { error: "Missing required field: provider_id" },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, provider_id, status, started_at, ready_for_next_at, service_id")
      .eq("id", orderId)
      .single()

    if (orderErr || !order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 })
    }

    if (String((order as any).provider_id ?? "") !== providerId) {
      return NextResponse.json(
        { error: "Order does not belong to this provider" },
        { status: 403 },
      )
    }

    const status = String((order as any).status ?? "")
    const allowedStatuses = ["in_progress"]
    if (!allowedStatuses.includes(status)) {
      return NextResponse.json(
        {
          error:
            "Order is not in a state where ready-for-next can be enabled",
          status,
        },
        { status: 400 },
      )
    }

    let durationMinutes = normalizeServiceDurationMinutes(null)
    const serviceId = String((order as { service_id?: string }).service_id || "")
    if (serviceId) {
      const { data: service } = await supabase
        .from("services")
        .select("duration_minutes")
        .eq("id", serviceId)
        .maybeSingle()
      durationMinutes = normalizeServiceDurationMinutes(
        (service as { duration_minutes?: number } | null)?.duration_minutes,
      )
    }

    const remainingMs = readyForNextRemainingMs(
      (order as { started_at?: string | null }).started_at,
      durationMinutes,
    )
    if (remainingMs > 0) {
      return NextResponse.json(
        {
          error: "TOO_EARLY",
          retry_after_seconds: Math.ceil(remainingMs / 1000),
          service_duration_minutes: durationMinutes,
          unlock_at_half_duration: true,
        },
        { status: 409 },
      )
    }

    const stampIso = new Date().toISOString()

    const { data: updated, error: updateErr } = await supabase
      .from("orders")
      .update({ ready_for_next_at: stampIso })
      .eq("id", orderId)
      .eq("provider_id", providerId)
      .in("status", allowedStatuses)
      .select("id, ready_for_next_at")
      .limit(1)

    if (updateErr) throw updateErr
    if (!updated || updated.length === 0) {
      return NextResponse.json(
        {
          error:
            "Order state changed before update could complete. Please refresh.",
        },
        { status: 409 },
      )
    }

    // Best-effort event log; do not fail the request if this errors.
    try {
      await supabase.from("order_events").insert([
        {
          order_id: orderId,
          event_type: "ready_for_next",
          actor_id: providerId,
        },
      ])
    } catch (logErr) {
      console.warn("[ready-for-next] event log failed", logErr)
    }

    return NextResponse.json({
      success: true,
      order_id: orderId,
      ready_for_next_at: (updated[0] as any).ready_for_next_at ?? stampIso,
    })
  } catch (error) {
    console.error("[ready-for-next] error:", error)
    return NextResponse.json(
      { error: "Failed to set ready-for-next" },
      { status: 500 },
    )
  }
}
