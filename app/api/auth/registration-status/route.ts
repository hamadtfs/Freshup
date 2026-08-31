import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { isCustomerRegistrationIncomplete } from "@/lib/auth/phone-identity"

/**
 * GET /api/auth/registration-status
 * Auth: x-user-id (same pattern as /api/customers/me).
 * Returns whether the signed-in user still needs profile registration.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = req.headers.get("x-user-id")
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const admin = createAdminClient()
    const [{ data: profile }, authUser] = await Promise.all([
      admin
        .from("profiles")
        .select("display_name, phone, email")
        .eq("id", userId)
        .maybeSingle(),
      admin.auth.admin.getUserById(userId),
    ])

    const user = authUser.data?.user
    const meta = (user?.user_metadata || {}) as Record<string, unknown>
    const incomplete = isCustomerRegistrationIncomplete({
      displayName: profile?.display_name,
      metaName: typeof meta.name === "string" ? meta.name : null,
      metaFullName: typeof meta.full_name === "string" ? meta.full_name : null,
    })

    return NextResponse.json({
      incomplete,
      hasPhone: Boolean(user?.phone || profile?.phone),
      displayName:
        String(profile?.display_name || meta.full_name || meta.name || "").trim() ||
        null,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
