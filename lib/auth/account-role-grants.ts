import type { DashboardMode } from "@/lib/auth/dashboard-mode"
import type { SupabaseClient } from "@supabase/supabase-js"

export type RoleGrantStatus = "pending" | "active" | "suspended"

export type AccountRoleGrant = {
  role: DashboardMode
  status: RoleGrantStatus
  activated_at: string | null
}

export async function listAccountRoleGrants(
  supabase: SupabaseClient,
  userId: string,
): Promise<AccountRoleGrant[]> {
  const { data, error } = await supabase
    .from("account_role_grants")
    .select("role, status, activated_at")
    .eq("user_id", userId)

  if (error) {
    // Table may not be migrated yet — caller falls back to detail rows.
    if (error.code === "42P01" || /account_role_grants/i.test(error.message)) {
      return []
    }
    console.warn("[account_role_grants] list:", error.message)
    return []
  }

  const out: AccountRoleGrant[] = []
  for (const row of data ?? []) {
    const role = row.role === "provider" || row.role === "customer" ? row.role : null
    const status =
      row.status === "pending" ||
      row.status === "active" ||
      row.status === "suspended"
        ? row.status
        : null
    if (!role || !status) continue
    out.push({
      role,
      status,
      activated_at: row.activated_at ? String(row.activated_at) : null,
    })
  }
  return out
}

export async function upsertAccountRoleGrant(
  supabase: SupabaseClient,
  userId: string,
  role: DashboardMode,
  status: RoleGrantStatus,
): Promise<{ ok: boolean; error?: string }> {
  const existing = (await listAccountRoleGrants(supabase, userId)).find(
    (g) => g.role === role,
  )
  // Never downgrade active / suspended to pending (skills save / Connect).
  if (
    status === "pending" &&
    (existing?.status === "active" || existing?.status === "suspended")
  ) {
    return { ok: true }
  }

  const { error: rpcErr } = await supabase.rpc("upsert_account_role_grant", {
    p_user_id: userId,
    p_role: role,
    p_status: status,
    p_activate: status === "active",
  })
  if (!rpcErr) return { ok: true }

  // Fallback direct upsert if RPC missing / not migrated.
  const { error } = await supabase.from("account_role_grants").upsert(
    {
      user_id: userId,
      role,
      status,
      activated_at: status === "active" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,role" },
  )
  if (error) {
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

/** True when grant lets the user use that app shell (pending or active). */
export function grantAllowsAppAccess(status: RoleGrantStatus | null | undefined): boolean {
  return status === "pending" || status === "active"
}

export function grantIsActive(status: RoleGrantStatus | null | undefined): boolean {
  return status === "active"
}
