import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { resolveCanonicalService, serviceIdCandidates } from "@/lib/service-id"

export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const providerId = req.headers.get("x-provider-id")
    const body = (await req.json()) as {
      service_id?: string
      is_active?: boolean
      available_now?: boolean
    }

    if (!providerId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (!body?.service_id) {
      return NextResponse.json({ error: "service_id is required" }, { status: 400 })
    }

    const goingOnline =
      body.available_now ??
      (typeof body.is_active === "boolean" ? body.is_active : true)

    const candidates = serviceIdCandidates(body.service_id)
    const { data: rows, error: readErr } = await supabase
      .from("provider_skills")
      .select("provider_id,service_id,mode_id")
      .eq("provider_id", providerId)
      .in("service_id", candidates.length ? candidates : ["__none__"])
    if (readErr) throw readErr
    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: "Skill not found for provider" }, { status: 404 })
    }

    const serviceIds = rows.map((r) => r.service_id)
    const serviceIdSet = new Set(serviceIds)
    const now = new Date().toISOString()

    const { error: updateErr } = await supabase
      .from("provider_skills")
      .update({
        available_now: goingOnline,
        updated_at: now,
      })
      .eq("provider_id", providerId)
      .in("service_id", serviceIds)
    if (updateErr) throw updateErr

    // One catalog mode online at a time: e.g. beauty can't stay live with vehicle.
    let activeModeId =
      rows.map((r) => String(r.mode_id || "").trim()).find(Boolean) || null
    if (goingOnline && !activeModeId) {
      const canonical = await resolveCanonicalService<{ mode_id?: string }>(
        supabase,
        body.service_id,
      )
      activeModeId = String(canonical?.mode_id || "").trim() || null
    }

    let deactivatedOtherModes = 0
    if (goingOnline && activeModeId) {
      const { data: onlineRows, error: onlineReadErr } = await supabase
        .from("provider_skills")
        .select("service_id,mode_id")
        .eq("provider_id", providerId)
        .eq("available_now", true)
      if (onlineReadErr) throw onlineReadErr

      const toDeactivate: string[] = []
      for (const row of onlineRows || []) {
        const sid = String(row.service_id || "")
        if (!sid || serviceIdSet.has(sid)) continue

        let mode = String(row.mode_id || "").trim()
        if (!mode) {
          const canonical = await resolveCanonicalService<{ mode_id?: string }>(
            supabase,
            sid,
          )
          mode = String(canonical?.mode_id || "").trim()
        }
        if (mode && mode !== activeModeId) {
          toDeactivate.push(sid)
        }
      }

      if (toDeactivate.length > 0) {
        const { error: deactivateErr } = await supabase
          .from("provider_skills")
          .update({ available_now: false, updated_at: now })
          .eq("provider_id", providerId)
          .in("service_id", toDeactivate)
        if (deactivateErr) throw deactivateErr
        deactivatedOtherModes = toDeactivate.length
      }
    }

    return NextResponse.json({
      success: true,
      provider_id: providerId,
      service_ids: serviceIds,
      is_active: true,
      available_now: goingOnline,
      mode_id: activeModeId,
      deactivated_other_mode_skills: deactivatedOtherModes,
    })
  } catch (error) {
    console.error("[v0] Provider skill status error:", error)
    return NextResponse.json(
      { error: "Failed to update provider skill status" },
      { status: 500 },
    )
  }
}
