import { createAdminClient } from "@/lib/supabase/server";
import { dispatchTick } from "@/lib/orders/dispatchTick";
import {
  normalizeServiceDurationMinutes,
  readyForNextRemainingMs,
} from "@/lib/orders/readyForNext";
import { NextRequest, NextResponse } from "next/server";

    /** Provider opts into receiving the next dispatch offer while finishing an in_progress job. */
export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient();
    const body = (await req.json()) as {
      order_id?: string;
      provider_id?: string;
      enabled?: boolean;
    };
    const { order_id, provider_id } = body;
    const enabled = body.enabled !== false;

    const orderId = String(order_id || "").trim();
    const providerId = String(provider_id || "").trim();
    if (!orderId || !providerId) {
      return NextResponse.json(
        { ok: false, error: "MISSING_FIELDS" },
        { status: 400 },
      );
    }

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, provider_id, status, started_at, service_id")
      .eq("id", orderId)
      .maybeSingle();
    if (orderErr || !order) {
      return NextResponse.json(
        { ok: false, error: "ORDER_NOT_FOUND" },
        { status: 404 },
      );
    }

    if (String(order.provider_id || "") !== providerId) {
      return NextResponse.json(
        { ok: false, error: "FORBIDDEN" },
        { status: 403 },
      );
    }

    if (String(order.status || "") !== "in_progress") {
      return NextResponse.json(
        { ok: false, error: "NOT_IN_PROGRESS" },
        { status: 409 },
      );
    }

    if (!enabled) {
      const { error: clearErr } = await supabase
        .from("orders")
        .update({
          ready_for_next_request_at: null,
          ready_for_next_at: null,
        })
        .eq("id", orderId)
        .eq("provider_id", providerId)
        .eq("status", "in_progress");

      if (clearErr) {
        return NextResponse.json(
          { ok: false, error: "UPDATE_FAILED", detail: clearErr.message },
          { status: 500 },
        );
      }

      return NextResponse.json({
        ok: true,
        ready_for_next_request_at: null,
        ready_for_next_at: null,
      });
    }

    const startedAtIso = (order as { started_at?: string | null }).started_at;
    let durationMinutes = normalizeServiceDurationMinutes(null);
    const serviceId = String(
      (order as { service_id?: string }).service_id || "",
    );
    if (serviceId) {
      const { data: service } = await supabase
        .from("services")
        .select("duration_minutes")
        .eq("id", serviceId)
        .maybeSingle();
      durationMinutes = normalizeServiceDurationMinutes(
        (service as { duration_minutes?: number } | null)?.duration_minutes,
      );
    }

    const remainingMs = readyForNextRemainingMs(startedAtIso, durationMinutes);
    if (remainingMs > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "TOO_EARLY",
          retry_after_seconds: Math.ceil(remainingMs / 1000),
          service_duration_minutes: durationMinutes,
          unlock_at_half_duration: true,
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    // Stamp both timestamps: newer RPC/migrations use `ready_for_next_request_at`;
    // older `match_providers` builds may still gate on `ready_for_next_at` only.
    const { error: updErr } = await supabase
      .from("orders")
      .update({
        ready_for_next_request_at: now,
        ready_for_next_at: now,
      })
      .eq("id", orderId)
      .eq("provider_id", providerId)
      .eq("status", "in_progress");

    if (updErr) {
      return NextResponse.json(
        { ok: false, error: "UPDATE_FAILED", detail: updErr.message },
        { status: 500 },
      );
    }

    // Run dispatch immediately so the provider is not stuck until the next cron tick.
    let dispatchProcessed = 0;
    try {
      const tick = await dispatchTick(supabase, { limit: 25 });
      dispatchProcessed = tick.processed;
    } catch (e) {
      console.error("[ready_for_next] dispatch_tick failed", e);
    }

    return NextResponse.json({
      ok: true,
      ready_for_next_request_at: now,
      ready_for_next_at: now,
      dispatch_processed: dispatchProcessed,
    });
  } catch (e) {
    console.error("[ready_for_next]", e);
    return NextResponse.json(
      { ok: false, error: "READY_FOR_NEXT_ERROR" },
      { status: 500 },
    );
  }
}
