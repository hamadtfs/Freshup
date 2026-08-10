import { createAdminClient } from "@/lib/supabase/server"
import { getUserIdFromBearer } from "@/lib/supabase/route-user"
import {
  grantAllowsAppAccess,
  listAccountRoleGrants,
  type RoleGrantStatus,
} from "@/lib/auth/account-role-grants"
import {
  pickDashboardMode,
  metadataRoleFromUser,
  rolesFromFlags,
  type AccountRoles,
} from "@/lib/auth/resolve-account-roles"
import { NextRequest, NextResponse } from "next/server"

/**
 * GET — roles this account actually has.
 * Prefers account_role_grants when present; falls back to detail rows.
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const userId = await getUserIdFromBearer(supabase, req)
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const grants = await listAccountRoleGrants(supabase, userId)
    const byRole = new Map(grants.map((g) => [g.role, g.status] as const))

    const [{ data: provider }, { data: customer }, { data: skillRow }, { data: authUser }] =
      await Promise.all([
        supabase
          .from("provider_details")
          .select("id, lat, lng, admin_approved")
          .eq("id", userId)
          .maybeSingle(),
        supabase.from("customer_details").select("id").eq("id", userId).maybeSingle(),
        supabase
          .from("provider_skills")
          .select("id")
          .eq("provider_id", userId)
          .limit(1)
          .maybeSingle(),
        supabase.auth.admin.getUserById(userId),
      ])

    let customerStatus: RoleGrantStatus | null = byRole.get("customer") ?? null
    let providerStatus: RoleGrantStatus | null = byRole.get("provider") ?? null

    // Fill gaps from detail/skill rows:
    // - no grant rows yet (legacy), OR
    // - only one role was granted (e.g. customer) while provider_details/skills exist.
    if (!customerStatus && customer?.id) {
      customerStatus = "active"
    }
    if (!providerStatus && (provider?.id || skillRow?.id)) {
      providerStatus = provider?.admin_approved ? "active" : "pending"
    }

    const hasCustomer = grantAllowsAppAccess(customerStatus)
    const hasProvider = grantAllowsAppAccess(providerStatus)

    const intentParam = req.nextUrl.searchParams.get("intent")
    const preferredIntent =
      intentParam === "provider" || intentParam === "customer" ? intentParam : null

    const activeRoleMeta =
      authUser?.data?.user?.app_metadata?.active_role === "provider" ||
      authUser?.data?.user?.app_metadata?.active_role === "customer"
        ? (authUser.data.user.app_metadata.active_role as "customer" | "provider")
        : null

    const metaRole = metadataRoleFromUser(authUser?.data?.user ?? null)
    // Prefer durable active_role claim, then user/app app_role metadata.
    const storedRole = activeRoleMeta ?? metaRole

    const preferred = pickDashboardMode({
      hasCustomer,
      hasProvider,
      preferredIntent: preferredIntent ?? storedRole,
      stored: storedRole,
      metadataRole: metaRole,
    })

    // Mode switch when the account holds both roles (pending or active).
    // Single-role accounts get Become a provider / Book a service instead.
    // (Empty footer was a bug when provider was pending + customer active.)
    const canSwitch = hasCustomer && hasProvider

    const body: AccountRoles & {
      provider_has_skills: boolean
      provider_has_coords: boolean
    } = {
      user_id: userId,
      has_customer: hasCustomer,
      has_provider: hasProvider,
      roles: rolesFromFlags(hasCustomer, hasProvider),
      preferred,
      customer_status: customerStatus,
      provider_status: providerStatus,
      can_switch_modes: canSwitch,
      active_role: canSwitch ? storedRole ?? preferred : preferred,
      provider_has_skills: Boolean(skillRow?.id),
      provider_has_coords:
        provider?.lat != null &&
        provider?.lng != null &&
        Number.isFinite(Number(provider.lat)) &&
        Number.isFinite(Number(provider.lng)),
    }

    return NextResponse.json(body)
  } catch (e) {
    console.error("[auth/roles]", e)
    return NextResponse.json({ error: "FAILED" }, { status: 500 })
  }
}
