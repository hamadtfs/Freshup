import type { SupabaseClient } from "@supabase/supabase-js"
import { writeStoredDashboardMode } from "@/lib/auth/dashboard-mode"
import type { OAuthPendingPayload } from "@/lib/auth/oauth-pending"
import { persistProviderOnboardingForUser } from "@/lib/auth/provider-onboarding"
import {
  formatSignupPriceFailureMessage,
  resolveSignupPriceCoords,
  saveProviderSignupCoords,
  submitSignupBasePrices,
} from "@/lib/pricing/submit-signup-base-prices"

export async function completeOAuthSession(
  supabase: SupabaseClient,
  userId: string,
  pending: OAuthPendingPayload | null,
): Promise<void> {
  const role = pending?.role ?? "customer"
  writeStoredDashboardMode(userId, role)

  await supabase.auth.updateUser({
    data: { app_role: role },
  })

  if (role === "provider" && pending?.providerOnboarding) {
    const onboarding = pending.providerOnboarding
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
      const coords = await resolveSignupPriceCoords(
        userId,
        onboarding.signupCoords ?? null,
      )
      if (coords) {
        await saveProviderSignupCoords(userId, coords)
      }
      const failures = await submitSignupBasePrices({
        providerId: userId,
        servicePrices,
        serviceIds,
        coords,
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
