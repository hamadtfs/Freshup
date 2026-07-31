export type DashboardMode = "customer" | "provider"

function dashboardModeStorageKey(userId: string) {
  return `freshup.dashboardMode.${userId}`
}

export function readStoredDashboardMode(userId: string): DashboardMode | null {
  if (typeof window === "undefined") return null
  const value = localStorage.getItem(dashboardModeStorageKey(userId))
  if (value === "customer" || value === "provider") return value
  return null
}

export function writeStoredDashboardMode(userId: string, mode: DashboardMode) {
  if (typeof window === "undefined") return
  localStorage.setItem(dashboardModeStorageKey(userId), mode)
}

export function clearStoredDashboardMode(userId: string) {
  if (typeof window === "undefined") return
  localStorage.removeItem(dashboardModeStorageKey(userId))
}
