import { createAdminClient } from "@/lib/supabase/server";
import { getUserIdFromBearer } from "@/lib/supabase/route-user";
import {
  computeDemandZonesForGridIds,
  isDemandZoneStale,
  upsertDemandZones,
  type DemandZoneRow,
} from "@/lib/demand-zones/compute-zone";
import { gridIdsInBbox } from "@/lib/demand-zones/grid";
import { tierForAudience, tierLabel } from "@/lib/demand-zones/tiers";
import { resolveCanonicalService } from "@/lib/service-id";
import { NextRequest, NextResponse } from "next/server";

function parseNum(v: string | null): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient();
    const userId = await getUserIdFromBearer(supabase, req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = req.nextUrl.searchParams;
    const serviceIdRaw = String(params.get("service_id") || "").trim();
    if (!serviceIdRaw) {
      return NextResponse.json({ error: "service_id required" }, { status: 400 });
    }

    const canonical = await resolveCanonicalService<{ id: string }>(
      supabase,
      serviceIdRaw,
      "id",
    );
    if (!canonical?.id) {
      return NextResponse.json(
        {
          error: "SERVICE_NOT_FOUND",
          service_id: serviceIdRaw,
          hint: "Use a service id from the services table (e.g. low_fade or skin_fade).",
        },
        { status: 404 },
      );
    }
    const serviceId = String(canonical.id);

    const audienceRaw = params.get("audience");
    const audience =
      audienceRaw === "provider" ? "provider" : "customer";
    const language = params.get("lang") === "en" ? "en" : "no";

    const minLat = parseNum(params.get("min_lat"));
    const minLng = parseNum(params.get("min_lng"));
    const maxLat = parseNum(params.get("max_lat"));
    const maxLng = parseNum(params.get("max_lng"));

    if (
      minLat == null ||
      minLng == null ||
      maxLat == null ||
      maxLng == null
    ) {
      return NextResponse.json(
        { error: "min_lat, min_lng, max_lat, max_lng required" },
        { status: 400 },
      );
    }

    const centerLat = parseNum(params.get("center_lat"));
    const centerLng = parseNum(params.get("center_lng"));

    const gridIds = gridIdsInBbox(minLat, minLng, maxLat, maxLng, 200, {
      centerLat: centerLat ?? undefined,
      centerLng: centerLng ?? undefined,
    });
    if (gridIds.length === 0) {
      return NextResponse.json({
        audience,
        service_id: serviceId,
        service_id_requested: serviceIdRaw,
        zones: [],
      });
    }

    const { data: existingRows, error: readErr } = await supabase
      .from("demand_zones")
      .select("*")
      .eq("service_id", serviceId)
      .in("grid_id", gridIds);
    if (readErr) {
      throw new Error(`demand_zones read: ${readErr.message}`);
    }

    const rowByGrid = new Map<string, DemandZoneRow>();
    for (const row of existingRows ?? []) {
      rowByGrid.set(String(row.grid_id), row as DemandZoneRow);
    }

    const staleGridIds = gridIds.filter((gridId) => {
      const row = rowByGrid.get(gridId);
      return !row || isDemandZoneStale(row.computed_at as string);
    });

    if (staleGridIds.length > 0) {
      try {
        const computed = await computeDemandZonesForGridIds(
          supabase,
          staleGridIds,
          serviceId,
        );
        if (computed.length > 0) {
          await upsertDemandZones(supabase, computed);
          for (const row of computed) {
            rowByGrid.set(row.grid_id, row);
          }
        }
      } catch (computeErr) {
        const computeMsg =
          computeErr instanceof Error ? computeErr.message : String(computeErr);
        if (/foreign key|violates foreign key/i.test(computeMsg)) {
          return NextResponse.json(
            {
              error: "SERVICE_NOT_FOUND",
              service_id: serviceIdRaw,
              resolved_id: serviceId,
            },
            { status: 404 },
          );
        }
        throw computeErr;
      }
    }

    const zones: Array<Record<string, unknown>> = [];
    for (const gridId of gridIds) {
      const row = rowByGrid.get(gridId);
      if (!row) continue;

      const pct = Number(row.used_capacity_pct) || 0;
      const tier = tierForAudience(pct, audience);
      zones.push({
        grid_id: row.grid_id,
        service_id: row.service_id,
        center_lat: row.center_lat,
        center_lng: row.center_lng,
        used_capacity_pct: pct,
        active_bookings: row.active_bookings,
        online_providers: row.online_providers,
        tier,
        label: tierLabel(tier, audience, language),
        computed_at: row.computed_at,
      });
    }

    return NextResponse.json({
      audience,
      service_id: serviceId,
      service_id_requested: serviceIdRaw,
      zones,
      note:
        language === "en"
          ? "Interim straight-line delivery km elsewhere; Mapbox overlay in M5."
          : "Midlertidig rett-linje leverings-km andre steder; Mapbox overlay i M5.",
    });
  } catch (e: unknown) {
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
    console.error("[demand-zones]", msg);
    return NextResponse.json(
      { error: "DEMAND_ZONES_FAILED", message: msg },
      { status: 500 },
    );
  }
}
