import type { ProviderOnboardingInput } from "@/lib/auth/provider-onboarding"

export type OAuthPendingPayload = {
  role: "customer" | "provider"
  providerOnboarding?: ProviderOnboardingInput
}

const STORAGE_KEY = "freshup.oauth.pending"

export function saveOAuthPending(payload: OAuthPendingPayload) {
  if (typeof window === "undefined") return
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

export function consumeOAuthPending(): OAuthPendingPayload | null {
  if (typeof window === "undefined") return null
  const raw = sessionStorage.getItem(STORAGE_KEY)
  sessionStorage.removeItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as OAuthPendingPayload
  } catch {
    return null
  }
}

export function clearOAuthPending() {
  if (typeof window === "undefined") return
  sessionStorage.removeItem(STORAGE_KEY)
}
