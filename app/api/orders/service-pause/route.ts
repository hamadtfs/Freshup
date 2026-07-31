import { createAdminClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/** Pause or resume the in-progress service timer (provider only). */
export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient();
    const { order_id, provider_id, paused } = (await req.json()) as {
      order_id?: string;
      provider_id?: string;
      paused?: boolean;
    };

    const orderId = String(order_id || "").trim();
    const providerId = String(provider_id || "").trim();
    if (!orderId || !providerId || typeof paused !== "boolean") {
      return NextResponse.json(
        { ok: false, error: "MISSING_FIELDS" },
        { status: 400 },
      );
    }

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select(
        "id, provider_id, status, started_at, service_paused_at, service_paused_total_seconds",
      )
      .eq("id", orderId)
      .maybeSingle();
    if (orderErr || !order) {
      const missingColumn =
        orderErr &&
        typeof orderErr.message === "string" &&
        /column .* does not exist/i.test(orderErr.message);
      return NextResponse.json(
        {
          ok: false,
          error: missingColumn ? "MIGRATION_REQUIRED" : "ORDER_NOT_FOUND",
        },
        { status: missingColumn ? 503 : 404 },
      );
    }

    if (String(order.provider_id || "") !== providerId) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const status = String(order.status || "");
    if (status !== "in_progress") {
      return NextResponse.json(
        { ok: false, error: "INVALID_STATUS", status },
        { status: 409 },
      );
    }

    const nowIso = new Date().toISOString();
    const currentPausedAt = (order as { service_paused_at?: string | null })
      .service_paused_at;
    const currentTotal = Number(
      (order as { service_paused_total_seconds?: number })
        .service_paused_total_seconds ?? 0,
    );

    if (paused) {
      if (currentPausedAt) {
        return NextResponse.json({
          ok: true,
          idempotent: true,
          service_paused_at: currentPausedAt,
          service_paused_total_seconds: currentTotal,
        });
      }

      const { error: updErr } = await supabase
        .from("orders")
        .update({ service_paused_at: nowIso })
        .eq("id", orderId)
        .eq("provider_id", providerId)
        .eq("status", "in_progress");

      if (updErr) {
        return NextResponse.json(
          { ok: false, error: "UPDATE_FAILED", detail: updErr.message },
          { status: 500 },
        );
      }

      return NextResponse.json({
        ok: true,
        service_paused_at: nowIso,
        service_paused_total_seconds: currentTotal,
      });
    }

    if (!currentPausedAt) {
      return NextResponse.json({
        ok: true,
        idempotent: true,
        service_paused_at: null,
        service_paused_total_seconds: currentTotal,
      });
    }

    const pausedAtMs = new Date(currentPausedAt).getTime();
    const pauseDeltaSec = Number.isFinite(pausedAtMs)
      ? Math.max(0, Math.floor((Date.now() - pausedAtMs) / 1000))
      : 0;
    const nextTotal = currentTotal + pauseDeltaSec;

    const { error: updErr } = await supabase
      .from("orders")
      .update({
        service_paused_at: null,
        service_paused_total_seconds: nextTotal,
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

    return NextResponse.json({
      ok: true,
      service_paused_at: null,
      service_paused_total_seconds: nextTotal,
    });
  } catch (e) {
    console.error("[service-pause]", e);
    return NextResponse.json(
      { ok: false, error: "SERVICE_PAUSE_ERROR" },
      { status: 500 },
    );
  }
}
