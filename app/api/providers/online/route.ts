import { createAdminClient } from "@/lib/supabase/server"
import { getUserIdFromBearer } from "@/lib/supabase/route-user"
import {
  evaluateProviderOnlineGate,
  forceProviderOffline,
  providerOnlineGateMessage,
  type ProviderOnlineBlockReason,
} from "@/lib/payments/provider-eligibility"
import { NextRequest, NextResponse } from "next/server"

function denyOnline(error: ProviderOnlineBlockReason) {
  return NextResponse.json(
    {
      error,
      message: providerOnlineGateMessage(error),
      success: false,
      is_online: false,
    },
    { status: error === "PROVIDER_NOT_FOUND" ? 404 : 403 },
  )
}

async function resolveProviderId(
  req: NextRequest,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<string | null> {
  const fromBearer = await getUserIdFromBearer(supabase, req)
  const headerId = req.headers.get("x-provider-id")?.trim() || null
  if (fromBearer && headerId && fromBearer !== headerId) return null
  return fromBearer || headerId
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const body = (await req.json().catch(() => ({}))) as {
      is_online?: unknown
      heartbeat?: unknown
      lat?: unknown
      lng?: unknown
    }
    const providerId = await resolveProviderId(req, supabase)

    if (!providerId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const isHeartbeat = body.heartbeat === true
    const nowIso = new Date().toISOString()
    const lat =
      typeof body.lat === "number" && Number.isFinite(body.lat)
        ? body.lat
        : undefined
    const lng =
      typeof body.lng === "number" && Number.isFinite(body.lng)
        ? body.lng
        : undefined

    const gate = await evaluateProviderOnlineGate(supabase, providerId)

    if (isHeartbeat) {
      if (!gate.ok) {
        if (gate.error !== "PROVIDER_NOT_FOUND") {
          await forceProviderOffline(supabase, providerId)
        }
        return NextResponse.json({
          success: true,
          is_online: false,
          heartbeat: false,
          error: gate.error,
        })
      }

      const { data: existing, error: readErr } = await supabase
        .from("provider_details")
        .select("is_online")
        .eq("id", providerId)
        .maybeSingle()
      if (readErr) throw readErr

      if (existing?.is_online !== true) {
        return NextResponse.json({
          success: true,
          is_online: false,
          heartbeat: false,
        })
      }

      const { error } = await supabase
        .from("provider_details")
        .update({
          last_online_at: nowIso,
          ...(lat != null && lng != null ? { lat, lng } : {}),
        })
        .eq("id", providerId)
        .eq("is_online", true)
      if (error) throw error

      return NextResponse.json({
        success: true,
        is_online: true,
        heartbeat: true,
      })
    }

    const is_online = Boolean(body.is_online)

    if (is_online) {
      if (!gate.ok) {
        await forceProviderOffline(supabase, providerId)
        return denyOnline(gate.error ?? "ADMIN_PENDING")
      }

      const { data: updated, error } = await supabase
        .from("provider_details")
        .update({
          is_online: true,
          last_online_at: nowIso,
          updated_at: nowIso,
          ...(lat != null && lng != null ? { lat, lng } : {}),
        })
        .eq("id", providerId)
        .select("id")
        .maybeSingle()
      if (error) throw error
      if (!updated?.id) {
        return denyOnline("PROVIDER_NOT_FOUND")
      }

      return NextResponse.json({ success: true, is_online: true })
    }

    await forceProviderOffline(supabase, providerId)
    return NextResponse.json({ success: true, is_online: false })
  } catch (error) {
    console.error("[v0] Toggle online error:", error)
    return NextResponse.json(
      { error: "Failed to update status" },
      { status: 500 }
    )
  }
}
