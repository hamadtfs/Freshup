import type { SupabaseClient } from "@supabase/supabase-js"
import { haversineKm } from "@/lib/geo"
import { providerPresenceCutoffIso } from "@/lib/provider/presence"
import type { DeliveryMode, MatchedProvider, ServiceModeId } from "@/lib/customer/types"

/**
 * Optional dev / staging seed data for API tests (online provider + coords, sample add-on, skills backfill):
 * `supabase/migrations/20260410180000_customer_matching_seed.sql`
 * Apply migrations manually; see workspace migration policy.
 */

const MAX_DISTANCE_KM = 10

const BLOCKING_ORDER_STATUSES = ["assigned", "en_route", "arrived", "in_progress"] as const

export type MatchProvidersInput = {
  serviceId: string
  modeId: string
  targetId: string
  categoryId: string
  serviceModeId: ServiceModeId
  deliveryMode: DeliveryMode
  customerLat: number
  customerLng: number
  /** When set, exclude this user from matches (self-booking). */
  customerId?: string | null
}

function allowedServiceModeIds(deliveryMode: DeliveryMode): string[] {
  if (deliveryMode === "home") return ["home", "both"]
  return ["provider", "both"]
}

/** Strict hierarchy + distance (≤10 km) + online + no active assigned job; sort by distance then service rating. */
export async function matchProviders(supabase: SupabaseClient, input: MatchProvidersInput): Promise<MatchedProvider[]> {
  const { data: service, error: serviceErr } = await supabase
    .from("services")
    .select("id, mode_id, target_id, category_id, name")
    .eq("id", input.serviceId)
    .eq("is_active", true)
    .maybeSingle()

  if (serviceErr || !service) return []

  if (input.modeId !== service.mode_id) return []
  if (input.targetId !== service.target_id) return []
  if (input.categoryId !== service.category_id) return []

  const allowedModes = allowedServiceModeIds(input.deliveryMode)
  if (!allowedModes.includes(input.serviceModeId)) return []

  const { data: skills, error: skillsErr } = await supabase
    .from("provider_skills")
    .select("provider_id, service_mode_id, competence_rating, available_now")
    .eq("service_id", input.serviceId)
    .eq("mode_id", service.mode_id)
    .eq("target_id", service.target_id)
    .eq("category_id", service.category_id)
    .eq("is_active", true)

  let candidateProviderIds: string[] = []
  if (!skillsErr && skills?.length) {
    candidateProviderIds = [
      ...new Set(
        skills
          .filter(
            (s) =>
              s.available_now !== false &&
              (s.service_mode_id === "both" ||
                input.serviceModeId === "both" ||
                (s.service_mode_id as string) === input.serviceModeId),
          )
          .map((s) => s.provider_id as string),
      ),
    ]
  }

  if (candidateProviderIds.length === 0) return []

  const customerId = input.customerId?.trim() || null
  if (customerId) {
    candidateProviderIds = candidateProviderIds.filter((id) => id !== customerId)
  }
  if (candidateProviderIds.length === 0) return []

  const { data: busyRows } = await supabase
    .from("orders")
    .select("provider_id, status, ready_for_next_request_at, is_test")
    .in("status", [...BLOCKING_ORDER_STATUSES])
    .not("provider_id", "is", null)
    .eq("is_test", false)

  const busy = new Set<string>()
  for (const r of busyRows ?? []) {
    const pid = r.provider_id as string
    if (!pid) continue
    if (r.status === "in_progress" && r.ready_for_next_request_at) continue
    busy.add(pid)
  }

  const { data: detailsList, error: detailsErr } = await supabase
    .from("provider_details")
    .select(
      "id, business_name, lat, lng, is_online, avg_rating, last_online_at",
    )
    .in("id", candidateProviderIds)
    .eq("is_online", true)
    .gte("last_online_at", providerPresenceCutoffIso())

  if (detailsErr || !detailsList?.length) return []

  const { data: skillRows } = await supabase
    .from("provider_skills")
    .select("provider_id, competence_rating, available_now")
    .eq("service_id", input.serviceId)
    .in("provider_id", candidateProviderIds)
    .eq("is_active", true)

  const competenceByProvider = new Map<string, number>()
  const availableByProvider = new Set<string>()
  for (const row of skillRows ?? []) {
    if (row.available_now === false) continue
    const pid = row.provider_id as string
    availableByProvider.add(pid)
    competenceByProvider.set(pid, row.competence_rating as number)
  }

  const customer = { lat: input.customerLat, lng: input.customerLng }
  const out: MatchedProvider[] = []

  for (const pd of detailsList) {
    if (!availableByProvider.has(pd.id as string)) continue
    if (!pd.is_online) continue
    if (busy.has(pd.id as string)) continue
    const plat = pd.lat != null ? Number(pd.lat) : NaN
    const plng = pd.lng != null ? Number(pd.lng) : NaN
    const hasCoords = !Number.isNaN(plat) && !Number.isNaN(plng)
    if (!hasCoords && input.deliveryMode !== "at_provider") continue

    const distanceKm = hasCoords
      ? haversineKm(customer, { lat: plat, lng: plng })
      : 0
    if (distanceKm > MAX_DISTANCE_KM) continue

    const competence = competenceByProvider.get(pd.id as string)
    const avg = pd.avg_rating != null ? Number(pd.avg_rating) : null
    const serviceRating = competence ?? avg ?? 0

    out.push({
      provider_id: pd.id as string,
      business_name: (pd.business_name as string | null) ?? null,
      distance_km: Math.round(distanceKm * 100) / 100,
      service_rating: serviceRating,
      avg_rating: avg,
    })
  }

  out.sort((a, b) => {
    if (a.distance_km !== b.distance_km) return a.distance_km - b.distance_km
    return b.service_rating - a.service_rating
  })

  return out
}
