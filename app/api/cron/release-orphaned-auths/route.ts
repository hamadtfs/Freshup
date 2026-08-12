import { createAdminClient } from "@/lib/supabase/server";
import { cleanupOrphanedAuthorizedLocks } from "@/lib/payments/orphaned-auth-locks";
import { NextRequest, NextResponse } from "next/server";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV === "development";

  const auth = req.headers.get("authorization") || "";
  if (auth === `Bearer ${secret}`) return true;
  return req.headers.get("x-cron-secret") === secret;
}

/**
 * Pre-launch payment hygiene: cancel Stripe holds on expired price locks
 * that never created an order (including the 8 Jul / 22 Jul 2026 rows).
 */
async function run(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun =
    url.searchParams.get("dryRun") === "1" ||
    url.searchParams.get("dry_run") === "1";
  const limitRaw = Number(url.searchParams.get("limit") || "50");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 50;

  try {
    const supabase = createAdminClient();
    const result = await cleanupOrphanedAuthorizedLocks(supabase, {
      dryRun,
      limit,
    });
    return NextResponse.json({ ok: true, dryRun, ...result });
  } catch (e) {
    console.error("[cron/release-orphaned-auths]", e);
    return NextResponse.json(
      { error: "Orphaned auth cleanup failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  return run(req);
}

export async function GET(req: NextRequest) {
  return run(req);
}
