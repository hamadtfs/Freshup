import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

type ProviderTransitionStatus = "en_route" | "arrived" | "in_progress";

const VALID_FROM: Record<ProviderTransitionStatus, string[]> = {
  // Provider just claimed the job → can start driving.
  en_route: ["assigned", "accepted", "en_route"],
  // After driving → mark arrived.
  arrived: ["en_route", "assigned", "accepted", "arrived"],
  // After arriving (or skipping at_provider) → start the service.
  in_progress: ["arrived", "en_route", "assigned", "accepted", "in_progress"],
};

const TIMESTAMP_FIELD: Partial<Record<ProviderTransitionStatus, string>> = {
  // `started_at` is part of the base schema. `en_route_at` / `arrived_at`
  // were added by a later migration; we attempt to write them but tolerate
  // the column-missing error so older DBs still work.
  in_progress: "started_at",
};

const OPTIONAL_TIMESTAMP_FIELD: Partial<
  Record<ProviderTransitionStatus, string>
> = {
  en_route: "en_route_at",
  arrived: "arrived_at",
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      order_id?: string;
      provider_id?: string;
      next_status?: ProviderTransitionStatus;
    };

    const orderId = String(body.order_id || "").trim();
    const providerId = String(body.provider_id || "").trim();
    const next = body.next_status as ProviderTransitionStatus | undefined;

    if (!orderId || !providerId || !next) {
      return NextResponse.json(
        { ok: false, error: "MISSING_FIELDS" },
        { status: 400 },
      );
    }
    if (!(next in VALID_FROM)) {
      return NextResponse.json(
        { ok: false, error: "INVALID_TARGET_STATUS" },
        { status: 400 },
      );
    }

    const supabase = createAdminClient();

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, provider_id, status")
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
        { ok: false, error: "NOT_ASSIGNED_PROVIDER" },
        { status: 403 },
      );
    }

    const current = String(order.status || "");

    // Idempotent: same-state click returns ok without re-writing.
    if (current === next) {
      return NextResponse.json({
        ok: true,
        order_id: orderId,
        status: next,
        idempotent: true,
      });
    }

    const allowedFrom = VALID_FROM[next];
    if (!allowedFrom.includes(current)) {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_FROM_STATUS",
          current_status: current,
        },
        { status: 400 },
      );
    }

    const nowIso = new Date().toISOString();
    const update: Record<string, unknown> = { status: next };
    const tsField = TIMESTAMP_FIELD[next];
    if (tsField) update[tsField] = nowIso;
    const optTs = OPTIONAL_TIMESTAMP_FIELD[next];
    if (optTs) update[optTs] = nowIso;

    let { error: updErr } = await supabase
      .from("orders")
      .update(update)
      .eq("id", orderId)
      .eq("provider_id", providerId)
      .in("status", allowedFrom);

    // Retry without the optional timestamp column if it doesn't exist in this DB.
    if (
      updErr &&
      optTs &&
      typeof updErr.message === "string" &&
      /column .* does not exist/i.test(updErr.message)
    ) {
      const retryUpdate = { ...update };
      delete retryUpdate[optTs];
      const { error: retryErr } = await supabase
        .from("orders")
        .update(retryUpdate)
        .eq("id", orderId)
        .eq("provider_id", providerId)
        .in("status", allowedFrom);
      updErr = retryErr;
    }

    if (updErr) {
      return NextResponse.json(
        { ok: false, error: "TRANSITION_FAILED", message: updErr.message },
        { status: 500 },
      );
    }

    // Best-effort audit log; ignore failures.
    try {
      await supabase.from("order_events").insert({
        order_id: orderId,
        event_type: `provider_transition_${next}`,
        actor_id: providerId,
        metadata: { from_status: current, to_status: next },
      });
    } catch {
      // observability only
    }

    return NextResponse.json({
      ok: true,
      order_id: orderId,
      status: next,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: "TRANSITION_FAILED",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}
