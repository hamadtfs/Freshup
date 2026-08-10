import type { SupabaseClient } from "@supabase/supabase-js"
import { writeStoredDashboardMode } from "@/lib/auth/dashboard-mode"
import type { OAuthPendingPayload } from "@/lib/auth/oauth-pending"
import { persistProviderOnboardingForUser } from "@/lib/auth/provider-onboarding"
import {
  formatSignupPriceFailureMessage,
  saveProviderSignupCoords,
  submitSignupBasePrices,
} from "@/lib/pricing/submit-signup-base-prices"

export async function completeOAuthSession(
  supabase: SupabaseClient,
  userId: string,
  pending: OAuthPendingPayload | null,
): Promise<void> {
  // Prefer pending signup intent; otherwise keep existing metadata (do not
  // invent "customer" when a returning provider has no pending payload).
  const { data: userData } = await supabase.auth.getUser()
  const metaRole = userData.user?.user_metadata?.app_role
  const role =
    pending?.role ??
    (metaRole === "provider" || metaRole === "customer" ? metaRole : "customer")
  writeStoredDashboardMode(userId, role)

  await supabase.auth.updateUser({
    data: { app_role: role },
  })

  if (role === "provider" && pending?.providerOnboarding) {
    const onboarding = pending.providerOnboarding
    if (
      !onboarding.signupCoords ||
      !Number.isFinite(onboarding.signupCoords.lat) ||
      !Number.isFinite(onboarding.signupCoords.lng)
    ) {
      throw new Error(
        "Location is required to finish provider signup. Enable GPS and try again.",
      )
    }
    await persistProviderOnboardingForUser(supabase, userId, onboarding)

    const serviceIds = onboarding.mode_selections.flatMap((ms) =>
      (ms.services || []).map((s) => s.service_id),
    )
    const servicePrices = onboarding.servicePrices || {}
    const hasPrices = serviceIds.some((id) => {
      const parsed = Number(String(servicePrices[id] || "").trim())
      return Number.isFinite(parsed) && parsed > 0
    })

    if (hasPrices) {
      await saveProviderSignupCoords(userId, onboarding.signupCoords)
      const failures = await submitSignupBasePrices({
        providerId: userId,
        servicePrices,
        serviceIds,
        coords: onboarding.signupCoords,
      })
      if (failures.length > 0) {
        throw new Error(formatSignupPriceFailureMessage(failures, true))
      }
    }

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("providerSkillsUpdated"))
    }
  }
}
