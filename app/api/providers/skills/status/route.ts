import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { getUserIdFromBearer } from "@/lib/supabase/route-user"
import { resolveCanonicalService, serviceIdCandidates } from "@/lib/service-id"
import {
  evaluateProviderOnlineGate,
  providerOnlineGateMessage,
} from "@/lib/payments/provider-eligibility"

export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const fromBearer = await getUserIdFromBearer(supabase, req)
    const providerId =
      fromBearer || req.headers.get("x-provider-id")?.trim() || null
    const body = (await req.json()) as {
      service_id?: string
      is_active?: boolean
      available_now?: boolean
      /** Per-service delivery mode (Munib: working-card toggle). */
      service_mode_id?: "home" | "provider" | "both"
      lat?: number
      lng?: number
    }

    if (!providerId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (!body?.service_id) {
      return NextResponse.json({ error: "service_id is required" }, { status: 400 })
    }

    const modeUpdate =
      body.service_mode_id === "home" ||
      body.service_mode_id === "provider" ||
      body.service_mode_id === "both"
        ? body.service_mode_id
        : null

    const hasAvailabilityUpdate =
      typeof body.available_now === "boolean" ||
      typeof body.is_active === "boolean"

    // Mode-only update: skip Connect gate / available_now side effects.
    if (modeUpdate && !hasAvailabilityUpdate) {
      const candidates = serviceIdCandidates(body.service_id)
      const { data: rows, error: readErr } = await supabase
        .from("provider_skills")
        .select("provider_id,service_id")
        .eq("provider_id", providerId)
        .in("service_id", candidates.length ? candidates : ["__none__"])
      if (readErr) throw readErr
      if (!rows || rows.length === 0) {
        return NextResponse.json(
          { error: "Skill not found for provider" },
          { status: 404 },
        )
      }
      const serviceIds = rows.map((r) => r.service_id)
      const now = new Date().toISOString()
      const { error: updateErr } = await supabase
        .from("provider_skills")
        .update({
          service_mode_id: modeUpdate,
          offers_home: modeUpdate === "home" || modeUpdate === "both",
          offers_at_provider:
            modeUpdate === "provider" || modeUpdate === "both",
          updated_at: now,
        })
        .eq("provider_id", providerId)
        .in("service_id", serviceIds)
      if (updateErr) throw updateErr
      return NextResponse.json({
        success: true,
        provider_id: providerId,
        service_ids: serviceIds,
        service_mode_id: modeUpdate,
      })
    }

    const goingOnline =
      body.available_now ??
      (typeof body.is_active === "boolean" ? body.is_active : true)

    if (goingOnline) {
      const gate = await evaluateProviderOnlineGate(supabase, providerId)
      if (!gate.ok) {
        return NextResponse.json(
          {
            error: gate.error,
            message: providerOnlineGateMessage(gate.error),
          },
          { status: gate.error === "PROVIDER_NOT_FOUND" ? 404 : 403 },
        )
      }
    }

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

    const skillPatch: Record<string, unknown> = {
      available_now: goingOnline,
      is_active: true,
      updated_at: now,
    }
    if (modeUpdate) {
      skillPatch.service_mode_id = modeUpdate
      skillPatch.offers_home = modeUpdate === "home" || modeUpdate === "both"
      skillPatch.offers_at_provider =
        modeUpdate === "provider" || modeUpdate === "both"
    }

    const { error: updateErr } = await supabase
      .from("provider_skills")
      .update(skillPatch)
      .eq("provider_id", providerId)
      .in("service_id", serviceIds)
    if (updateErr) throw updateErr

    // Going live on a skill also marks the provider present for nearby counts.
    if (goingOnline) {
      const presencePatch: Record<string, unknown> = {
        is_online: true,
        last_online_at: now,
      }
      if (
        typeof body.lat === "number" &&
        Number.isFinite(body.lat) &&
        typeof body.lng === "number" &&
        Number.isFinite(body.lng)
      ) {
        presencePatch.lat = body.lat
        presencePatch.lng = body.lng
      }
      const { error: presenceErr } = await supabase
        .from("provider_details")
        .upsert(
          { id: providerId, ...presencePatch },
          { onConflict: "id" },
        )
      if (presenceErr) throw presenceErr
    }

    // First go-online with no mode yet → both (Munib default).
    if (goingOnline && !modeUpdate) {
      const { error: nullModeErr } = await supabase
        .from("provider_skills")
        .update({
          service_mode_id: "both",
          offers_home: true,
          offers_at_provider: true,
          updated_at: now,
        })
        .eq("provider_id", providerId)
        .in("service_id", serviceIds)
        .is("service_mode_id", null)
      if (nullModeErr) throw nullModeErr
    }

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
