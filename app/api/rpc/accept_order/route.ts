import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export async function POST(req: Request) {
  try {
    const { order_id, provider_id } = (await req.json()) as { order_id: string; provider_id: string }
    const supabase = createAdminClient()

    // First-wins: set provider if not set yet and still searching
    const { data, error } = await supabase
      .from("orders")
      .update({ provider_id, status: "assigned" })
      .eq("id", order_id)
      .eq("status", "searching")
      .is("provider_id", null)
      .select()
    if (error) return NextResponse.json({ ok: false, error: "UPDATE_FAILED" }, { status: 500 })

    const won = (data?.length ?? 0) > 0
    if (won) {
      // Expire other offers
      await supabase
        .from("order_offers")
        .update({ status: "expired" })
        .eq("order_id", order_id)
        .neq("provider_id", provider_id)
      await supabase
        .from("order_offers")
        .update({ status: "accepted" })
        .eq("order_id", order_id)
        .eq("provider_id", provider_id)
    }

    return NextResponse.json({ ok: won })
  } catch {
    return NextResponse.json({ ok: false, error: "ACCEPT_ERROR" }, { status: 500 })
  }
}
