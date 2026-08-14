import type { DashboardMode } from "@/lib/auth/dashboard-mode"

const KEY = "freshup.login_role_intent"

export function peekLoginRoleIntent(): DashboardMode | null {
  if (typeof window === "undefined") return null
  try {
    const value = sessionStorage.getItem(KEY)
    return value === "provider" || value === "customer" ? value : null
  } catch {
    return null
  }
}

export function writeLoginRoleIntent(role: DashboardMode) {
  if (typeof window === "undefined") return
  try {
    sessionStorage.setItem(KEY, role)
  } catch {
    /* ignore */
  }
}

export function takeLoginRoleIntent(): DashboardMode | null {
  const value = peekLoginRoleIntent()
  if (typeof window === "undefined") return value
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
  return value
}
