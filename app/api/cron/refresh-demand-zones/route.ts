import {
  markStaleProvidersOffline,
} from "@/lib/provider/presence";
import { createAdminClient } from "@/lib/supabase/server";
import {
  DEFAULT_DEMAND_REFRESH_BBOX,
  refreshDemandZonesInBbox,
} from "@/lib/demand-zones/refresh-bbox";
import { NextRequest, NextResponse } from "next/server";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV === "development";

  const auth = req.headers.get("authorization") || "";
  if (auth === `Bearer ${secret}`) return true;
  return req.headers.get("x-cron-secret") === secret;
}

/**
 * Background refresh for Opptatt / demand_zones (M4 data layer).
 * Schedule every 5–10 min via Vercel Cron or external ping when CRON_SECRET is set.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();
    const staleCleared = await markStaleProvidersOffline(supabase);
    const body = (await req.json().catch(() => ({}))) as {
      service_ids?: string[];
      max_services?: number;
    };

    let serviceIds = (body.service_ids ?? [])
      .map((id) => String(id).trim())
      .filter(Boolean);

    if (serviceIds.length === 0) {
      const { data: services, error } = await supabase
        .from("services")
        .select("id")
        .eq("is_active", true)
        .limit(body.max_services ?? 12);
      if (error) throw new Error(error.message);
      serviceIds = (services ?? []).map((s) => String(s.id));
    }

    if (serviceIds.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "No services to refresh",
        upserted: 0,
      });
    }

    const result = await refreshDemandZonesInBbox(
      supabase,
      serviceIds,
      DEFAULT_DEMAND_REFRESH_BBOX,
    );

    return NextResponse.json({
      ok: true,
      bbox: DEFAULT_DEMAND_REFRESH_BBOX,
      stale_providers_cleared: staleCleared,
      ...result,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/demand_zones/i.test(msg) && /does not exist/i.test(msg)) {
      return NextResponse.json(
        {
          error: "DEMAND_ZONES_NOT_MIGRATED",
          message: "Apply migration 20260525140000_demand_zones.sql manually.",
        },
        { status: 503 },
      );
    }
    console.error("[cron/refresh-demand-zones]", msg);
    return NextResponse.json(
      { error: "REFRESH_FAILED", message: msg },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
