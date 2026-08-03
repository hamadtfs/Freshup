import { createAdminClient } from "@/lib/supabase/server"
import { getUserIdFromBearer } from "@/lib/supabase/route-user"
import { NextRequest, NextResponse } from "next/server"

const PLATFORMS = new Set(["ios", "android", "web"])
const ROLES = new Set(["customer", "provider"])

export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const userId = await getUserIdFromBearer(supabase, req)
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as {
      token?: string
      platform?: string
      app_role?: string
      device_id?: string
    }

    const token = typeof body.token === "string" ? body.token.trim() : ""
    const platform =
      typeof body.platform === "string" ? body.platform.trim().toLowerCase() : ""
    const appRole =
      typeof body.app_role === "string" ? body.app_role.trim().toLowerCase() : null
    const deviceId =
      typeof body.device_id === "string" ? body.device_id.trim() || null : null

    if (!token || !token.startsWith("ExponentPushToken[")) {
      return NextResponse.json({ error: "Invalid Expo push token" }, { status: 400 })
    }
    if (!PLATFORMS.has(platform)) {
      return NextResponse.json({ error: "Invalid platform" }, { status: 400 })
    }
    if (appRole && !ROLES.has(appRole)) {
      return NextResponse.json({ error: "Invalid app_role" }, { status: 400 })
    }

    const now = new Date().toISOString()

    const { data, error } = await supabase
      .from("push_tokens")
      .upsert(
        {
          user_id: userId,
          token,
          platform,
          app_role: appRole,
          device_id: deviceId,
          is_active: true,
          last_seen_at: now,
          updated_at: now,
        },
        { onConflict: "token" },
      )
      .select("id, token")
      .single()

    if (error) throw error

    return NextResponse.json({ ok: true, id: data?.id, token: data?.token })
  } catch (error) {
    console.error("[push/register]", error)
    return NextResponse.json(
      { error: "Failed to register push token" },
      { status: 500 },
    )
  }
}
