import { createAdminClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"

export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const body = (await req.json().catch(() => ({}))) as {
      is_online?: unknown
      heartbeat?: unknown
    }
    const providerId = req.headers.get("x-provider-id")

    if (!providerId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const isHeartbeat = body.heartbeat === true
    const nowIso = new Date().toISOString()

    if (isHeartbeat) {
      // Presence ping while the provider toggle is on — refresh last_online_at.
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
        .update({ last_online_at: nowIso })
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
    const { error } = await supabase
      .from("provider_details")
      .upsert(
        {
          id: providerId,
          is_online,
          last_online_at: nowIso,
        },
        { onConflict: "id" },
      )

    if (error) throw error

    return NextResponse.json({ success: true, is_online })
  } catch (error) {
    console.error("[v0] Toggle online error:", error)
    return NextResponse.json(
      { error: "Failed to update status" },
      { status: 500 }
    )
  }
}
