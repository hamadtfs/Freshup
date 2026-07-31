import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { SERVICE_ID_ALIASES, serviceIdCandidates } from "@/lib/service-id"

interface OnboardingPayload {
  business_name?: string
  description?: string
  phone?: string
  address?: string
  lat?: number
  lng?: number
  delivery_modes: string[]
  mode_selections: {
    mode_id: string
    targets: string[]
    categories: string[]
    services: {
      service_id: string
      competence_rating: number
    }[]
  }[]
}

function resolveServiceModeId(deliveryModes: string[]): "home" | "provider" | "both" {
  const normalized = (deliveryModes || []).map((m) => String(m).toLowerCase())
  const hasHome = normalized.includes("home")
  const hasProvider = normalized.includes("provider") || normalized.includes("at_provider")
  if (hasHome && hasProvider) return "both"
  if (hasProvider) return "provider"
  return "home"
}

function serviceSignature(value: string): string {
  const tokens = String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean)
    .sort()
  return tokens.join("|")
}

function serviceTokens(value: string): string[] {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean)
}

function matchesHierarchyValue(
  selectedSet: Set<string>,
  candidate: unknown,
): boolean {
  if (selectedSet.size === 0) return true
  const raw = String(candidate || "").trim()
  if (!raw) return false
  if (selectedSet.has(raw)) return true
  const suffix = raw.split("_").pop() || ""
  if (selectedSet.has(suffix)) return true
  for (const selected of selectedSet) {
    if (raw.endsWith(`_${selected}`)) return true
  }
  return false
}

function resolveHierarchyIdFromSelection(
  selectedValues: string[],
  validSet: Set<string>,
): string | null {
  const normalizedSelections = (selectedValues || [])
    .map((v) => String(v || "").trim())
    .filter(Boolean)
  for (const selected of normalizedSelections) {
    if (validSet.has(selected)) return selected
    for (const valid of validSet) {
      if (valid.endsWith(`_${selected}`)) return valid
    }
  }
  return null
}

async function persistDirect(providerId: string, payload: OnboardingPayload) {
  const supabase = createAdminClient()
  const serviceModeId = resolveServiceModeId(payload.delivery_modes || [])

  const { data: existing, error: existingErr } = await supabase
    .from("provider_details")
    .select("business_name, description, phone, address, lat, lng, delivery_modes")
    .eq("id", providerId)
    .maybeSingle()
  if (existingErr) throw existingErr

  const detailPatch: Record<string, unknown> = { id: providerId }
  if (payload.delivery_modes) {
    detailPatch.delivery_modes = payload.delivery_modes
  }
  if (typeof payload.business_name === "string" && payload.business_name.trim()) {
    detailPatch.business_name = payload.business_name.trim()
  } else if (existing?.business_name) {
    detailPatch.business_name = existing.business_name
  }
  if (typeof payload.description === "string" && payload.description.trim()) {
    detailPatch.description = payload.description.trim()
  } else if (existing?.description) {
    detailPatch.description = existing.description
  }
  if (typeof payload.phone === "string" && payload.phone.trim()) {
    detailPatch.phone = payload.phone.trim()
  } else if (existing?.phone) {
    detailPatch.phone = existing.phone
  }
  if (typeof payload.address === "string" && payload.address.trim()) {
    detailPatch.address = payload.address.trim()
  } else if (existing?.address) {
    detailPatch.address = existing.address
  }
  if (payload.lat != null) {
    detailPatch.lat = payload.lat
  } else if (existing?.lat != null) {
    detailPatch.lat = existing.lat
  }
  if (payload.lng != null) {
    detailPatch.lng = payload.lng
  } else if (existing?.lng != null) {
    detailPatch.lng = existing.lng
  }

  const { error: detailsErr } = await supabase
    .from("provider_details")
    .upsert(detailPatch, { onConflict: "id" })
  if (detailsErr) throw detailsErr

  // Replace provider skill graph with latest selections so old skills do not linger.
  const { error: resetSkillsErr } = await supabase
    .from("provider_skills")
    .delete()
    .eq("provider_id", providerId)
  if (resetSkillsErr) throw resetSkillsErr

  const { error: resetModesErr } = await supabase
    .from("provider_modes")
    .delete()
    .eq("provider_id", providerId)
  if (resetModesErr) throw resetModesErr

  const { error: resetTargetsErr } = await supabase
    .from("provider_targets")
    .delete()
    .eq("provider_id", providerId)
  if (resetTargetsErr) throw resetTargetsErr

  const { error: resetCategoriesErr } = await supabase
    .from("provider_categories")
    .delete()
    .eq("provider_id", providerId)
  if (resetCategoriesErr) throw resetCategoriesErr

  const selectedServiceIds = payload.mode_selections.flatMap((ms) =>
    (ms.services || []).flatMap((s) => serviceIdCandidates(s.service_id)),
  )
  const { data: serviceRows, error: servicesErr } = await supabase
    .from("services")
    .select("id, name, mode_id, target_id, category_id")
  if (servicesErr) throw servicesErr
  const [{ data: targetRows, error: targetsErr }, { data: categoryRows, error: categoriesErr }] =
    await Promise.all([
      supabase.from("targets").select("id"),
      supabase.from("categories").select("id"),
    ])
  if (targetsErr) throw targetsErr
  if (categoriesErr) throw categoriesErr
  const validTargetIds = new Set(
    (targetRows || []).map((row: any) => String(row?.id || "").trim()).filter(Boolean),
  )
  const validCategoryIds = new Set(
    (categoryRows || []).map((row: any) => String(row?.id || "").trim()).filter(Boolean),
  )
  const serviceById = new Map<string, any>()
  const servicesBySignature = new Map<string, any[]>()
  for (const row of serviceRows || []) {
    const rowId = String(row.id)
    for (const candidate of serviceIdCandidates(rowId)) {
      serviceById.set(candidate, row)
    }
    const idSig = serviceSignature(rowId)
    if (idSig) {
      servicesBySignature.set(idSig, [...(servicesBySignature.get(idSig) || []), row])
    }
    const nameSig = serviceSignature(String((row as any)?.name || ""))
    if (nameSig) {
      servicesBySignature.set(nameSig, [...(servicesBySignature.get(nameSig) || []), row])
    }
  }
  const resolveService = (
    serviceId: string,
    modeSelection: { mode_id: string; targets: string[]; categories: string[] },
  ) => {
    const normalizedServiceId = String(serviceId || "").trim().replace(/_/g, "-")
    const aliasCandidates = SERVICE_ID_ALIASES[normalizedServiceId] || []
    for (const aliasId of aliasCandidates) {
      const aliasResolved = serviceIdCandidates(aliasId)
        .map((candidateId) => serviceById.get(candidateId))
        .find(Boolean)
      if (aliasResolved) return aliasResolved
    }

    const direct = serviceIdCandidates(serviceId)
      .map((candidateId) => serviceById.get(candidateId))
      .find(Boolean)
    if (direct) return direct

    const sig = serviceSignature(serviceId)
    if (!sig) return null
    const candidates = servicesBySignature.get(sig) || []
    const requestedTokens = serviceTokens(serviceId)
    const relaxedCandidates =
      candidates.length > 0
        ? candidates
        : (serviceRows || []).filter((row: any) => {
            const idTokens = new Set(serviceTokens(String(row?.id || "")))
            const nameTokens = new Set(serviceTokens(String(row?.name || "")))
            return requestedTokens.every(
              (token) => idTokens.has(token) || nameTokens.has(token),
            )
          })
    if (relaxedCandidates.length === 0) return null

    const targetSet = new Set((modeSelection.targets || []).map((v) => String(v || "").trim()))
    const categorySet = new Set(
      (modeSelection.categories || []).map((v) => String(v || "").trim()),
    )

    const constrained = relaxedCandidates.filter((row) => {
      const sameMode = String(row?.mode_id || "") === String(modeSelection.mode_id || "")
      const sameTarget = matchesHierarchyValue(targetSet, row?.target_id)
      const sameCategory = matchesHierarchyValue(categorySet, row?.category_id)
      return sameMode && sameTarget && sameCategory
    })
    if (constrained.length > 0) return constrained[0]

    const sameModeOnly = relaxedCandidates.filter(
      (row) => String(row?.mode_id || "") === String(modeSelection.mode_id || ""),
    )
    // Avoid persisting wrong service rows (e.g. wrong target/category) when filters were provided.
    if ((targetSet.size > 0 || categorySet.size > 0) && sameModeOnly.length > 0) {
      return null
    }
    return sameModeOnly[0] || relaxedCandidates[0] || null
  }
  const validTargetIdsFromResolvedServices = new Set(
    (serviceRows || []).map((row: any) => String(row?.target_id || "").trim()).filter(Boolean),
  )
  const validCategoryIdsFromResolvedServices = new Set(
    (serviceRows || []).map((row: any) => String(row?.category_id || "").trim()).filter(Boolean),
  )
  const requestedServiceIds = [
    ...new Set(
      payload.mode_selections.flatMap((ms) =>
        (ms.services || []).map((s) => String(s.service_id || "").trim()),
      ),
    ),
  ].filter(Boolean)
  const unresolvedRequestedServiceIds = requestedServiceIds.filter((id) => {
    return !payload.mode_selections.some((ms) =>
      (ms.services || []).some(
        (s) => String(s?.service_id || "").trim() === id && !!resolveService(id, ms),
      ),
    )
  })
  if (unresolvedRequestedServiceIds.length > 0) {
    // Do not fail the whole onboarding when stale/local ids are sent by client.
    // We will persist all resolvable services and let the client verify saved rows.
    console.warn(
      "[providers/onboard] Skipping unknown service ids:",
      unresolvedRequestedServiceIds,
    )
  }
  let persistedSkillCount = 0

  for (const modeSelection of payload.mode_selections) {
    for (const targetId of modeSelection.targets || []) {
      await supabase
        .from("provider_skills")
        .delete()
        .eq("provider_id", providerId)
        .eq("mode_id", modeSelection.mode_id)
        .eq("target_id", targetId)

    }

    const { error: modeErr } = await supabase.from("provider_modes").upsert(
      { provider_id: providerId, mode_id: modeSelection.mode_id },
      { onConflict: "provider_id,mode_id" },
    )
    if (modeErr) throw modeErr

    for (const targetId of modeSelection.targets) {
      if (!validTargetIdsFromResolvedServices.has(String(targetId || "").trim())) {
        continue
      }
      if (!validTargetIds.has(String(targetId || "").trim())) {
        continue
      }
      const { error: targetErr } = await supabase.from("provider_targets").upsert(
        { provider_id: providerId, target_id: targetId },
        { onConflict: "provider_id,target_id" },
      )
      if (targetErr) throw targetErr
    }

    for (const categoryId of modeSelection.categories) {
      if (!validCategoryIdsFromResolvedServices.has(String(categoryId || "").trim())) {
        continue
      }
      if (!validCategoryIds.has(String(categoryId || "").trim())) {
        continue
      }
      const { error: categoryErr } = await supabase.from("provider_categories").upsert(
        { provider_id: providerId, category_id: categoryId },
        { onConflict: "provider_id,category_id" },
      )
      if (categoryErr) throw categoryErr
    }

    for (const service of modeSelection.services) {
      const resolvedService = resolveService(service.service_id, modeSelection)
      if (!resolvedService) continue
      const resolvedModeId = String(resolvedService.mode_id || modeSelection.mode_id || "").trim()
      if (!resolvedModeId) continue
      const resolvedTargetIdRaw = String(resolvedService.target_id || "").trim()
      const resolvedCategoryIdRaw = String(resolvedService.category_id || "").trim()
      const fallbackTargetId = resolveHierarchyIdFromSelection(
        modeSelection.targets || [],
        validTargetIds,
      )
      const fallbackCategoryId = resolveHierarchyIdFromSelection(
        modeSelection.categories || [],
        validCategoryIds,
      )
      const finalTargetId = validTargetIds.has(resolvedTargetIdRaw)
        ? resolvedTargetIdRaw
        : fallbackTargetId
      const finalCategoryId = validCategoryIds.has(resolvedCategoryIdRaw)
        ? resolvedCategoryIdRaw
        : fallbackCategoryId
      if (!finalTargetId || !finalCategoryId) continue

      // Persist strict hierarchy from actual service row (mode/target/category/service together).
      const { error: targetErr } = await supabase.from("provider_targets").upsert(
        { provider_id: providerId, target_id: finalTargetId },
        { onConflict: "provider_id,target_id" },
      )
      if (targetErr) throw targetErr

      const { error: categoryErr } = await supabase.from("provider_categories").upsert(
        { provider_id: providerId, category_id: finalCategoryId },
        { onConflict: "provider_id,category_id" },
      )
      if (categoryErr) throw categoryErr

      const { error: skillErr } = await supabase.from("provider_skills").upsert(
        {
          provider_id: providerId,
          service_id: resolvedService.id,
          competence_rating: service.competence_rating,
          is_active: true,
          available_now: true,
          mode_id: resolvedModeId,
          target_id: finalTargetId,
          category_id: finalCategoryId,
          service_mode_id: serviceModeId,
        },
        { onConflict: "provider_id,service_id" },
      )
      if (skillErr) throw skillErr
      persistedSkillCount += 1
    }
  }

  return {
    success: true,
    provider_id: providerId,
    persisted_via: "route_fallback",
    persisted_skill_count: persistedSkillCount,
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload: OnboardingPayload = await req.json()
    const providerId = req.headers.get("x-provider-id") // Set by middleware with auth

    if (!providerId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    if (!payload.mode_selections || payload.mode_selections.length === 0) {
      return NextResponse.json(
        { error: "Must select at least one mode" },
        { status: 400 }
      )
    }

    const direct = await persistDirect(providerId, payload)
    return NextResponse.json(direct)
  } catch (error) {
    console.error("[v0] Provider onboarding error:", error)
    return NextResponse.json(
      { error: "Failed to onboard provider" },
      { status: 500 }
    )
  }
}
