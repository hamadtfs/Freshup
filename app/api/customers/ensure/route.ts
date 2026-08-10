import { createAdminClient } from "@/lib/supabase/server"
import { getUserIdFromBearer } from "@/lib/supabase/route-user"
import { upsertAccountRoleGrant } from "@/lib/auth/account-role-grants"
import { NextRequest, NextResponse } from "next/server"

/**
 * POST — ensure this account can book as a customer (provider-only → dual mode).
 * Creates customer_details if missing and activates the customer role grant.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const userId = await getUserIdFromBearer(supabase, req)
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { error: detailsErr } = await supabase
      .from("customer_details")
      .upsert({ id: userId }, { onConflict: "id" })
    if (detailsErr) {
      console.error("[customers/ensure] customer_details", detailsErr)
      return NextResponse.json({ error: "ensure_failed" }, { status: 500 })
    }

    const grant = await upsertAccountRoleGrant(
      supabase,
      userId,
      "customer",
      "active",
    )
    if (!grant.ok) {
      console.error("[customers/ensure] grant", grant.error)
      return NextResponse.json(
        { error: grant.error || "grant_failed" },
        { status: 500 },
      )
    }

    return NextResponse.json({ ok: true, has_customer: true })
  } catch (e) {
    console.error("[customers/ensure]", e)
    return NextResponse.json({ error: "FAILED" }, { status: 500 })
  }
}
