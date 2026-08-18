import type { SupabaseClient } from "@supabase/supabase-js"

export type ProviderModeSelection = {
  mode_id: string
  targets: string[]
  categories: string[]
  services: Array<{
    service_id: string
    competence_rating: number
    service_mode_id?: "home" | "provider" | "both"
  }>
}

export type ProviderOnboardingInput = {
  profileName?: string
  profileAvatarUrl?: string
  phoneE164?: string | null
  mode_selections: ProviderModeSelection[]
  delivery_modes: Array<"home" | "at_provider">
  /** Typical prices keyed by canonical service id (spec §2.1). */
  servicePrices?: Record<string, string>
  signupCoords?: { lat: number; lng: number } | null
  skillsSnapshot?: {
    mode: string
    target: string
    categories: string[]
    services: string[]
    ratings: Record<string, number>
    deliveryMode: "home" | "provider"
    savedAt: number
  }
}

export async function persistProviderOnboardingForUser(
  supabase: SupabaseClient,
  providerId: string,
  input: ProviderOnboardingInput,
): Promise<void> {
  const { mode_selections, delivery_modes } = input

  if (mode_selections.length > 0) {
    const onboardRes = await fetch("/api/providers/onboard", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-provider-id": providerId,
      },
      body: JSON.stringify({
        delivery_modes,
        mode_selections,
        ...(input.signupCoords
          ? { lat: input.signupCoords.lat, lng: input.signupCoords.lng }
          : {}),
      }),
    })
    const onboardJson = (await onboardRes.json().catch(() => ({}))) as {
      error?: string
      persisted_skill_count?: number
    }
    if (!onboardRes.ok) {
      throw new Error(
        typeof onboardJson.error === "string"
          ? onboardJson.error
          : "Failed to save selected services.",
      )
    }
    const persistedSkillCount = Number(onboardJson.persisted_skill_count || 0)
    const selectedSkillCount = mode_selections.reduce(
      (sum, item) => sum + (Array.isArray(item.services) ? item.services.length : 0),
      0,
    )
    if (selectedSkillCount > 0 && persistedSkillCount === 0) {
      throw new Error(
        "Selected services could not be matched. Please reselect your services.",
      )
    }

    if (typeof window !== "undefined" && input.skillsSnapshot) {
      localStorage.setItem(
        `freshup.skills.snapshot.${providerId}`,
        JSON.stringify(input.skillsSnapshot),
      )
      localStorage.setItem(
        "freshup.skills.snapshot.last",
        JSON.stringify(input.skillsSnapshot),
      )
      window.dispatchEvent(new CustomEvent("providerSkillsUpdated"))
    }
  }

  const { data: userData } = await supabase.auth.getUser()
  const sessionEmail = userData.user?.email?.trim() || ""
  const profilePayload = {
    ...(input.profileName?.trim() ? { name: input.profileName.trim() } : {}),
    ...(input.phoneE164 ? { phone: input.phoneE164 } : {}),
    ...(input.profileAvatarUrl ? { avatarUrl: input.profileAvatarUrl } : {}),
    ...(sessionEmail ? { email: sessionEmail } : {}),
  }
  if (Object.keys(profilePayload).length > 0) {
    await fetch("/api/providers/me", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-provider-id": providerId,
      },
      body: JSON.stringify(profilePayload),
    })
  }

  await supabase.auth.updateUser({
    data: { app_role: "provider" },
  })
}
