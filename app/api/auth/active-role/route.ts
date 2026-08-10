import { createAdminClient } from "@/lib/supabase/server"
import { getUserIdFromBearer } from "@/lib/supabase/route-user"
import {
  grantAllowsAppAccess,
  listAccountRoleGrants,
} from "@/lib/auth/account-role-grants"
import type { DashboardMode } from "@/lib/auth/dashboard-mode"
import { NextRequest, NextResponse } from "next/server"

/**
 * POST — set active dashboard role as a JWT app_metadata claim and refresh identity.
 * Body: { role: "customer" | "provider" }
 *
 * Allowed when the account has that role grant (pending or active).
 * Suspended / missing → 403. Client must refreshSession() after success.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const userId = await getUserIdFromBearer(supabase, req)
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as { role?: string }
    const role: DashboardMode | null =
      body.role === "provider" || body.role === "customer" ? body.role : null
    if (!role) {
      return NextResponse.json({ error: "role required" }, { status: 400 })
    }

    const grants = await listAccountRoleGrants(supabase, userId)
    const status = grants.find((g) => g.role === role)?.status ?? null

    // Legacy fallback: detail row presence.
    let allowed = grantAllowsAppAccess(status)
    if (grants.length === 0) {
      if (role === "customer") {
        const { data } = await supabase
          .from("customer_details")
          .select("id")
          .eq("id", userId)
          .maybeSingle()
        allowed = Boolean(data?.id)
      } else {
        const { data } = await supabase
          .from("provider_details")
          .select("id")
          .eq("id", userId)
          .maybeSingle()
        allowed = Boolean(data?.id)
      }
    }

    if (!allowed) {
      return NextResponse.json(
        {
          error: "role_not_available",
          message:
            role === "provider"
              ? "Provider role is not on this account."
              : "Customer role is not on this account.",
        },
        { status: 403 },
      )
    }

    const { data: existing, error: getErr } =
      await supabase.auth.admin.getUserById(userId)
    if (getErr || !existing?.user) {
      return NextResponse.json({ error: "user_not_found" }, { status: 404 })
    }

    const prevApp = (existing.user.app_metadata ?? {}) as Record<string, unknown>
    const prevUser = (existing.user.user_metadata ?? {}) as Record<string, unknown>

    const { error: updErr } = await supabase.auth.admin.updateUserById(userId, {
      app_metadata: {
        ...prevApp,
        active_role: role,
        app_role: role,
      },
      user_metadata: {
        ...prevUser,
        app_role: role,
      },
    })
    if (updErr) {
      console.error("[auth/active-role] updateUserById", updErr)
      return NextResponse.json({ error: "update_failed" }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      active_role: role,
      refresh_session: true,
    })
  } catch (e) {
    console.error("[auth/active-role]", e)
    return NextResponse.json({ error: "FAILED" }, { status: 500 })
  }
}
