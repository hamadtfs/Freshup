import { createAdminClient } from "@/lib/supabase/server"
import { getUserIdFromBearer } from "@/lib/supabase/route-user"
import { NextRequest, NextResponse } from "next/server"

export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const userId = await getUserIdFromBearer(supabase, req)
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as { token?: string }
    const token = typeof body.token === "string" ? body.token.trim() : ""

    if (!token) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 })
    }

    const { error } = await supabase
      .from("push_tokens")
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("token", token)

    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[push/unregister]", error)
    return NextResponse.json(
      { error: "Failed to unregister push token" },
      { status: 500 },
    )
  }
}
