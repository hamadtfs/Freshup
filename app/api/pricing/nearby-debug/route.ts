import { createAdminClient } from "@/lib/supabase/server";
import { debugNearbyProviderMatch } from "@/lib/pricing/nearby-online-providers";
import { NextRequest, NextResponse } from "next/server";

function parseNumber(value: string | null): number | null {
  if (value == null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** GET /api/pricing/nearby-debug — dev helper for closed-market diagnosis. */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const params = req.nextUrl.searchParams;
  const lat = parseNumber(params.get("lat"));
  const lng = parseNumber(params.get("lng"));
  const serviceId = String(params.get("service_id") || "skin_fade").trim();
  const providerId = String(params.get("provider_id") || "").trim();
  const onlineModeRaw = params.get("online_mode") || "home";
  const onlineMode: "home" | "provider" =
    onlineModeRaw === "provider" ? "provider" : "home";

  if (lat == null || lng == null) {
    return NextResponse.json(
      { error: "lat and lng are required" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const debug = await debugNearbyProviderMatch(
    supabase,
    serviceId,
    lat,
    lng,
    onlineMode,
  );

  let providerFocus: Record<string, unknown> | null = null;
  if (providerId) {
    const { data: row } = await supabase
      .from("provider_details")
      .select(
        "id, is_online, last_online_at, stripe_payouts_enabled, admin_approved, lat, lng",
      )
      .eq("id", providerId)
      .maybeSingle();
    const inSkillPool = debug.provider_ids_from_skills.includes(providerId);
    providerFocus = {
      provider_id: providerId,
      in_skill_pool: inSkillPool,
      provider_details: row,
      skill_rows: debug.sample_skills.filter((s) => s.provider_id === providerId),
    };
  }

  return NextResponse.json({
    ...debug,
    provider_focus: providerFocus,
    dev_matching_relaxed: true,
    hint: "Check blockers[] — most common: admin_approved_false, stripe_payouts_enabled_false, delivery_mode_mismatch, provider_details.is_online_is_false",
  });
}
