import type { DashboardMode } from "@/lib/auth/dashboard-mode"
import type { RoleGrantStatus } from "@/lib/auth/account-role-grants"
import {
  pickDashboardMode,
  type AccountRoles,
} from "@/lib/auth/resolve-account-roles"

function asStatus(v: unknown): RoleGrantStatus | null {
  if (v === "pending" || v === "active" || v === "suspended") return v
  return null
}

export async function fetchAccountRoles(opts?: {
  accessToken?: string | null
  intent?: DashboardMode | null
  apiBase?: string
}): Promise<AccountRoles | null> {
  try {
    const q =
      opts?.intent === "provider" || opts?.intent === "customer"
        ? `?intent=${opts.intent}`
        : ""
    const headers: Record<string, string> = {}
    if (opts?.accessToken) {
      headers.Authorization = `Bearer ${opts.accessToken}`
    }
    const base = (opts?.apiBase ?? "").replace(/\/$/, "")
    const res = await fetch(`${base}/api/auth/roles${q}`, {
      cache: "no-store",
      headers,
    })
    if (!res.ok) return null
    const data = (await res.json()) as Partial<AccountRoles>
    if (!data?.user_id) return null
    const hasCustomer = Boolean(data.has_customer)
    const hasProvider = Boolean(data.has_provider)
    return {
      user_id: String(data.user_id),
      has_customer: hasCustomer,
      has_provider: hasProvider,
      roles: Array.isArray(data.roles)
        ? (data.roles.filter(
            (r) => r === "customer" || r === "provider",
          ) as DashboardMode[])
        : [],
      preferred:
        data.preferred === "provider" || data.preferred === "customer"
          ? data.preferred
          : pickDashboardMode({
              hasCustomer,
              hasProvider,
              preferredIntent: opts?.intent,
            }),
      customer_status: asStatus(data.customer_status) ?? null,
      provider_status: asStatus(data.provider_status) ?? null,
      can_switch_modes: Boolean(data.can_switch_modes),
      active_role:
        data.active_role === "provider" || data.active_role === "customer"
          ? data.active_role
          : null,
      provider_has_skills: Boolean(
        (data as { provider_has_skills?: boolean }).provider_has_skills,
      ),
    }
  } catch {
    return null
  }
}

/** Mint active_role JWT claim; caller should refreshSession afterwards. */
export async function setActiveRoleClaim(
  role: DashboardMode,
  opts?: { accessToken?: string | null; apiBase?: string },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    if (opts?.accessToken) {
      headers.Authorization = `Bearer ${opts.accessToken}`
    }
    const base = (opts?.apiBase ?? "").replace(/\/$/, "")
    const res = await fetch(`${base}/api/auth/active-role`, {
      method: "POST",
      headers,
      body: JSON.stringify({ role }),
    })
    const json = (await res.json().catch(() => ({}))) as {
      error?: string
      message?: string
    }
    if (!res.ok) {
      return {
        ok: false,
        error: String(json.message || json.error || "active_role_failed"),
      }
    }
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "active_role_failed",
    }
  }
}
