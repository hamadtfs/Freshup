import { createAdminClient } from "@/lib/supabase/server"
import { resolveCanonicalService, serviceIdCandidates } from "@/lib/service-id"
import { NextRequest, NextResponse } from "next/server"

// Sample add-on for `skin-fade` may be inserted by:
// supabase/migrations/20260410180000_customer_matching_seed.sql

/** GET /api/services/addons?service_id=... — active add-ons for one service (customer catalog step). */
export async function GET(req: NextRequest) {
  try {
    const serviceId = req.nextUrl.searchParams.get("service_id")
    if (!serviceId) {
      return NextResponse.json({ error: "service_id is required" }, { status: 400 })
    }

    const supabase = createAdminClient()
    const canonicalService = await resolveCanonicalService<{ id: string }>(
      supabase,
      serviceId,
      "id",
    )
    const resolvedServiceIds = canonicalService
      ? [canonicalService.id]
      : serviceIdCandidates(serviceId)

    const { data: addons, error } = await supabase
      .from("service_addons")
      .select("id, service_id, name, description, extra_price, extra_minutes")
      .in("service_id", resolvedServiceIds)
      .eq("is_active", true)
      .order("created_at", { ascending: true })

    if (error) {
      console.error("[addons] fetch error:", error)
      return NextResponse.json({ error: "Failed to fetch add-ons" }, { status: 500 })
    }

    return NextResponse.json({ addons: addons ?? [] })
  } catch (e) {
    console.error("[addons] error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
