import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { matchProviders } from "@/lib/orders/dispatchOrder";
import { dispatchTick } from "@/lib/orders/dispatchTick";


function requireDispatchSecret(req: NextRequest): NextResponse | null {
  const expected = process.env.DISPATCH_TICK_SECRET || "";
  const got = req.headers.get("x-dispatch-secret") || "";
  if (!expected || got !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function POST(req: NextRequest) {
  const authRes = requireDispatchSecret(req);
  if (authRes) return authRes;

  const supabase = createAdminClient();
  // Full `results` bloats every pg_net `_http_response` row (~28k/day at 3s cron).
  // Opt in with ?detail=1 for debugging only.
  const wantsDetail =
    req.nextUrl.searchParams.get("detail") === "1" ||
    req.headers.get("x-dispatch-detail") === "1";

  try {
    const { processed, results } = await dispatchTick(supabase, { limit: 25 });

    if (process.env.NODE_ENV !== "production") {
      const summary = results.reduce(
        (acc, r) => {
          acc[r.action] = (acc[r.action] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );
      const sample = results.slice(0, 10).map((r: any) => ({
        ...r,
        waves:
          Array.isArray(r?.waves) && r.waves.length > 0
            ? r.waves.map((w: any) => ({
                wave_index: w?.wave_index,
                wave_name: w?.wave_name,
                batch: w?.batch,
                performance_tier: w?.performance_tier,
                offers_sent: w?.offers_sent,
              }))
            : r?.waves,
      }));
      console.info("[dispatch_tick] summary", {
        processed,
        summary,
        sample,
      });
    }

    if (wantsDetail) {
      return NextResponse.json({ ok: true, processed, results });
    }

    return NextResponse.json({ ok: true, processed });
  } catch (err) {
    console.error("[dispatch_tick] error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}