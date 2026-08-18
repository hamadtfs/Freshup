import { createAdminClient } from "@/lib/supabase/server"
import { getUserIdFromBearer } from "@/lib/supabase/route-user"
import { upsertAccountRoleGrant } from "@/lib/auth/account-role-grants"
import { NextRequest, NextResponse } from "next/server"

/**
 * POST — ensure this account can book as a customer (provider-only → dual mode).
 * Activates the customer role grant. customer_details is created on first
 * booking / Stripe customer, not here at role switch.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const userId = await getUserIdFromBearer(supabase, req)
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
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
