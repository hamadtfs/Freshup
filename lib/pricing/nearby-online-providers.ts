/**
 * Count live online providers for a service within the dispatch match radius.
 * Used for closed-market detection (no providers nearby → base price, no booking).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { haversineKm } from "@/lib/geo";
import { MAX_DISPATCH_MATCH_RADIUS_KM } from "@/lib/orders/dispatch-radius";
import { providerPresenceCutoffIso } from "@/lib/provider/presence";
import { serviceIdCandidates } from "@/lib/service-id";

type AnyClient = SupabaseClient;

const DEV_NEARBY_RADIUS_KM = 100;

function isDevMatchingRelaxed(): boolean {
  return process.env.NODE_ENV === "development";
}

function skillIsActive(value: unknown): boolean {
  return value !== false;
}

function normalizeServiceModeId(
  serviceModeId: unknown,
): "home" | "provider" | "both" {
  const mode = String(serviceModeId || "both").trim().toLowerCase();
  if (!mode || mode === "both") return "both";
  if (mode === "at_provider") return "provider";
  if (mode === "home" || mode === "provider") return mode;
  return "both";
}

function skillMatchesMode(
  serviceModeId: unknown,
  modeFilter: "home" | "provider" | null,
): boolean {
  if (!modeFilter) return true;
  const mode = normalizeServiceModeId(serviceModeId);
  if (mode === "both") return true;
  return mode === modeFilter;
}

/** Stale-provider sweeps run on cron only — not while customers load prices. */
function providerWithinRadius(
  origin: { lat: number; lng: number },
  plat: number,
  plng: number,
  radiusKm: number,
): boolean {
  if (!Number.isFinite(plat) || !Number.isFinite(plng)) {
    return process.env.NODE_ENV === "development";
  }
  const distanceKm = haversineKm(origin, { lat: plat, lng: plng });
  if (distanceKm <= radiusKm) return true;
  if (process.env.NODE_ENV === "development") {
    return distanceKm <= DEV_NEARBY_RADIUS_KM;
  }
  return false;
}

type ProviderDetailsRow = {
  id: string;
  lat: number | null;
  lng: number | null;
  is_online?: boolean | null;
  stripe_payouts_enabled?: boolean | null;
  admin_approved?: boolean | null;
  last_online_at?: string | null;
};

function providerPassesEligibility(
  row: ProviderDetailsRow,
  cutoff: string,
  opts?: { hasAvailableSkill?: boolean },
): boolean {
  const hasSkill = opts?.hasAvailableSkill === true;
  const online = row.is_online === true;
  const fresh =
    typeof row.last_online_at === "string" &&
    row.last_online_at >= cutoff;

  // Skill toggle can leave available_now=true while is_online was cleared by stale sweep.
  const present = online || (hasSkill && fresh);
  if (!present) {
    if (isDevMatchingRelaxed() && hasSkill) return true;
    return false;
  }

  if (isDevMatchingRelaxed()) return true;
  if (!row.stripe_payouts_enabled) return false;
  if (!row.admin_approved) return false;
  if (!fresh && !online) return false;
  return true;
}

export type NearbyOnlineProviderCounts = {
  count: number;
  marketClosed: boolean;
};

export type NearbyMatchDebug = {
  service_id: string;
  online_mode: "home" | "provider" | null;
  customer: { lat: number; lng: number };
  service_id_candidates: string[];
  skills_available_now: number;
  skills_after_mode_filter: number;
  provider_ids_from_skills: string[];
  providers_is_online: number;
  providers_after_eligibility: number;
  providers_within_radius: number;
  blockers: string[];
  sample_skills: Array<{
    provider_id: string;
    service_id: string;
    service_mode_id: unknown;
    is_active: unknown;
    available_now: unknown;
  }>;
  sample_providers: Array<{
    id: string;
    is_online: boolean | null | undefined;
    stripe_payouts_enabled: boolean | null | undefined;
    admin_approved: boolean | null | undefined;
    last_online_at: string | null | undefined;
    lat: number | null;
    lng: number | null;
    within_radius: boolean;
    passes_eligibility: boolean;
  }>;
};

/** Dev-only: step-by-step breakdown of why nearby count is 0. */
export async function debugNearbyProviderMatch(
  supabase: AnyClient,
  serviceId: string,
  lat: number,
  lng: number,
  serviceModeId?: "home" | "provider" | null,
  radiusKm: number = MAX_DISPATCH_MATCH_RADIUS_KM,
): Promise<NearbyMatchDebug> {
  const candidateIds = serviceIdCandidates(serviceId);
  const modeFilter =
    serviceModeId === "home" || serviceModeId === "provider"
      ? serviceModeId
      : null;
  const cutoff = providerPresenceCutoffIso();
  const blockers: string[] = [];

  const { data: skills } = await supabase
    .from("provider_skills")
    .select(
      "provider_id, service_id, service_mode_id, is_active, available_now",
    )
    .in("service_id", candidateIds);

  const allSkillRows = skills ?? [];

  const availableSkills = allSkillRows.filter(
    (s) => s.available_now === true && skillIsActive(s.is_active),
  );
  const modeSkills = availableSkills.filter((s) =>
    skillMatchesMode(s.service_mode_id, modeFilter),
  );
  const providerIds = [
    ...new Set(modeSkills.map((s) => String(s.provider_id)).filter(Boolean)),
  ];

  if ((allSkillRows).length === 0) {
    blockers.push("no_provider_skills_rows_for_service_id");
  }
  if (availableSkills.length === 0) {
    blockers.push("no_skills_with_available_now_and_active");
  }
  if (modeSkills.length === 0 && availableSkills.length > 0) {
    blockers.push(`delivery_mode_mismatch: customer wants ${modeFilter ?? "any"}`);
  }

  const { data: providers } = await supabase
    .from("provider_details")
    .select(
      "id, lat, lng, is_online, stripe_payouts_enabled, admin_approved, last_online_at",
    )
    .in("id", providerIds.length ? providerIds : ["00000000-0000-0000-0000-000000000000"]);

  const origin = { lat, lng };
  const onlineProviders = (providers ?? []).filter((p) => p.is_online === true);
  const eligible = (providers ?? []).filter((p) =>
    providerPassesEligibility(p, cutoff, { hasAvailableSkill: true }),
  );
  const withinRadius = eligible.filter((p) =>
    providerWithinRadius(origin, Number(p.lat), Number(p.lng), radiusKm),
  );

  if (providerIds.length > 0 && onlineProviders.length === 0) {
    if (!(isDevMatchingRelaxed() && modeSkills.length > 0)) {
      blockers.push("provider_details.is_online_is_false");
    }
  }
  if (!isDevMatchingRelaxed()) {
    if (onlineProviders.some((p) => !p.stripe_payouts_enabled)) {
      blockers.push("stripe_payouts_enabled_false");
    }
    if (onlineProviders.some((p) => !p.admin_approved)) {
      blockers.push("admin_approved_false");
    }
    if (onlineProviders.some((p) => !p.last_online_at || p.last_online_at < cutoff)) {
      blockers.push("last_online_at_stale_or_missing");
    }
  }
  if (eligible.length > 0 && withinRadius.length === 0) {
    blockers.push("provider_outside_match_radius");
  }

  return {
    service_id: serviceId,
    online_mode: modeFilter,
    customer: { lat, lng },
    service_id_candidates: candidateIds,
    skills_available_now: availableSkills.length,
    skills_after_mode_filter: modeSkills.length,
    provider_ids_from_skills: providerIds,
    providers_is_online: onlineProviders.length,
    providers_after_eligibility: eligible.length,
    providers_within_radius: withinRadius.length,
    blockers,
    sample_skills: allSkillRows
      .filter((s) => s.available_now === true)
      .slice(0, 20)
      .map((s) => ({
      provider_id: String(s.provider_id),
      service_id: String(s.service_id),
      service_mode_id: s.service_mode_id,
      is_active: s.is_active,
      available_now: s.available_now,
    })),
    sample_providers: (providers ?? []).slice(0, 5).map((p) => ({
      id: String(p.id),
      is_online: p.is_online,
      stripe_payouts_enabled: p.stripe_payouts_enabled,
      admin_approved: p.admin_approved,
      last_online_at: p.last_online_at,
      lat: p.lat != null ? Number(p.lat) : null,
      lng: p.lng != null ? Number(p.lng) : null,
      within_radius: providerWithinRadius(
        origin,
        Number(p.lat),
        Number(p.lng),
        radiusKm,
      ),
      passes_eligibility: providerPassesEligibility(p, cutoff, {
        hasAvailableSkill: providerIds.includes(String(p.id)),
      }),
    })),
  };
}

export async function countOnlineProvidersNearby(
  supabase: AnyClient,
  serviceId: string,
  lat: number,
  lng: number,
  radiusKm: number = MAX_DISPATCH_MATCH_RADIUS_KM,
  serviceModeId?: "home" | "provider" | null,
): Promise<NearbyOnlineProviderCounts> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { count: 0, marketClosed: true };
  }

  const candidateIds = serviceIdCandidates(serviceId);
  const { data: skills, error: skillsErr } = await supabase
    .from("provider_skills")
    .select("provider_id, service_mode_id, is_active")
    .in("service_id", candidateIds)
    .eq("available_now", true);

  if (skillsErr) {
    console.error("[pricing] nearby providers skills error:", skillsErr);
    return { count: 0, marketClosed: true };
  }

  const modeFilter =
    serviceModeId === "home" || serviceModeId === "provider"
      ? serviceModeId
      : null;

  const providerIds = [
    ...new Set(
      (skills ?? [])
        .filter((s) => skillIsActive(s.is_active))
        .filter((s) => skillMatchesMode(s.service_mode_id, modeFilter))
        .map((s) => String(s.provider_id))
        .filter(Boolean),
    ),
  ];
  if (providerIds.length === 0) {
    return { count: 0, marketClosed: true };
  }

  const cutoff = providerPresenceCutoffIso();
  const { data: providers, error: providersErr } = await supabase
    .from("provider_details")
    .select(
      "id, lat, lng, is_online, stripe_payouts_enabled, admin_approved, last_online_at",
    )
    .in("id", providerIds);

  if (providersErr) {
    console.error("[pricing] nearby providers details error:", providersErr);
    return { count: 0, marketClosed: true };
  }

  const origin = { lat, lng };
  let count = 0;
  for (const p of providers ?? []) {
    if (
      !providerPassesEligibility(p, cutoff, {
        hasAvailableSkill: providerIds.includes(String(p.id)),
      })
    ) {
      continue;
    }
    const plat = Number(p.lat);
    const plng = Number(p.lng);
    if (providerWithinRadius(origin, plat, plng, radiusKm)) {
      count += 1;
    }
  }

  return { count, marketClosed: count === 0 };
}

type OnlineProviderPoint = { id: string; lat: number; lng: number };

export async function countOnlineProvidersNearbyForServices(
  supabase: AnyClient,
  serviceIds: string[],
  lat: number,
  lng: number,
  radiusKm: number = MAX_DISPATCH_MATCH_RADIUS_KM,
  serviceModeId?: "home" | "provider" | null,
): Promise<Map<string, NearbyOnlineProviderCounts>> {
  const result = new Map<string, NearbyOnlineProviderCounts>();
  const uniqueIds = [...new Set(serviceIds.filter(Boolean))];
  for (const id of uniqueIds) {
    result.set(id, { count: 0, marketClosed: true });
  }
  if (
    uniqueIds.length === 0 ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return result;
  }

  const allCandidates = [
    ...new Set(uniqueIds.flatMap((id) => serviceIdCandidates(id))),
  ];

  const { data: skills, error: skillsErr } = await supabase
    .from("provider_skills")
    .select("provider_id, service_id, service_mode_id, is_active")
    .in("service_id", allCandidates)
    .eq("available_now", true);

  if (skillsErr) {
    console.error("[pricing] bulk nearby skills error:", skillsErr);
    return result;
  }

  const modeFilter =
    serviceModeId === "home" || serviceModeId === "provider"
      ? serviceModeId
      : null;

  const providersByService = new Map<string, Set<string>>();
  const allProviderIds = new Set<string>();
  for (const row of skills ?? []) {
    if (!skillIsActive(row.is_active)) continue;
    const sid = String(row.service_id);
    const pid = String(row.provider_id);
    if (!sid || !pid) continue;
    if (!skillMatchesMode(row.service_mode_id, modeFilter)) continue;
    allProviderIds.add(pid);
    let set = providersByService.get(sid);
    if (!set) {
      set = new Set();
      providersByService.set(sid, set);
    }
    set.add(pid);
  }

  if (allProviderIds.size === 0) return result;

  const cutoff = providerPresenceCutoffIso();
  const { data: providers, error: providersErr } = await supabase
    .from("provider_details")
    .select(
      "id, lat, lng, is_online, stripe_payouts_enabled, admin_approved, last_online_at",
    )
    .in("id", [...allProviderIds]);

  if (providersErr) {
    console.error("[pricing] bulk nearby details error:", providersErr);
    return result;
  }

  const onlinePoints: OnlineProviderPoint[] = [];
  for (const p of providers ?? []) {
    if (
      !providerPassesEligibility(p, cutoff, {
        hasAvailableSkill: allProviderIds.has(String(p.id)),
      })
    ) {
      continue;
    }
    onlinePoints.push({
      id: String(p.id),
      lat: Number(p.lat),
      lng: Number(p.lng),
    });
  }

  const origin = { lat, lng };
  for (const serviceId of uniqueIds) {
    const candidateSet = new Set<string>();
    for (const cand of serviceIdCandidates(serviceId)) {
      const pids = providersByService.get(cand);
      if (!pids) continue;
      for (const pid of pids) candidateSet.add(pid);
    }
    let count = 0;
    for (const point of onlinePoints) {
      if (!candidateSet.has(point.id)) continue;
      if (providerWithinRadius(origin, point.lat, point.lng, radiusKm)) {
        count += 1;
      }
    }
    result.set(serviceId, { count, marketClosed: count === 0 });
  }

  return result;
}
