import type { SupabaseClient } from "@supabase/supabase-js";

export const SERVICE_ID_ALIASES: Record<string, string[]> = {
  "skin-fade": ["skin_fade"],
  "low-fade": ["low_fade"],
  "mid-fade": ["mid_fade"],
  "high-fade": ["high_fade"],
  "classic-cut": ["classic_cut_m"],
  "classic-cut-m": ["classic_cut_m"],
  "classic-cut-f": ["classic_cut_f"],
  layers: ["layers_f"],
  bob: ["bob_f"],
  pixie: ["pixie_f", "pixie-cut", "pixie_cut"],
  relaxation: ["massage_relaxation"],
  relaxing: ["massage_relaxation"],
  "deep-tissue": ["massage_deep_tissue"],
  sports: ["massage_sports"],
  "sport-massage": ["massage_sports"],
  assessment: ["physio_assessment"],
  treatment: ["physio_treatment"],
  rehabilitation: ["physio_rehab"],
  rehab: ["physio_rehab"],
  therapy: ["mental_therapy"],
  stress: ["mental_stress"],
  "talk therapy": ["mental_therapy"],
  coaching: ["mental_coaching"],
  "stress management": ["mental_stress"],
  yoga: ["group_yoga"],
  pilates: ["group_pilates"],
  hiit: ["group_hiit"],
  meditation: ["wellness_meditation", "group_meditation"],
  breathing: ["wellness_breathing"],
  breathwork: ["wellness_breathing", "group_breathing"],
  // Apartment/Home-service UI ids (used in dashboard + skills UI)
  "basic-clean": ["apt_regular_clean"],
  "leak-repair": ["apt_faucet_leak"],
  drain: ["apt_drain_clog"],
  "faucet-apt": ["apt_faucet_leak"],
  "toilet-apt": ["apt_toilet_issue"],
  // Apartment electrician (support both new seed ids and legacy ids)
  "outlet-install": ["apt_outlet_repair", "apt_outlets"],
  "light-install": ["apt_light_fixture", "apt_light_point"],
  "tire-rotation": ["car_tire_rotation"],
  "regular-clean-apt": ["apt_regular_clean"],
  "deep-clean-apt": ["apt_deep_clean"],
  "window-clean-apt": ["apt_window_clean"],
  "drain-apt": ["apt_drain_clog"],
  "faucet-apt": ["apt_faucet_leak"],
  "toilet-apt": ["apt_toilet_issue"],
  "light-apt": ["apt_light_point", "apt_light_fixture"],
  "outlet-apt": ["apt_outlets", "apt_outlet_repair"],
  "fuse-apt": ["apt_fuse_box"],
  // House/Home-service UI ids (used in dashboard + skills UI)
  "basic-clean-h": ["house_regular_clean"],
  "deep-clean-h": ["house_deep_clean"],
  "drain-h": ["house_drain_clog"],
  "pipe-repair": ["house_pipe_repair"],
  "faucet-house": ["house_faucet_leak"],
  "water-heater": ["house_water_heater"],
  "panel-service": ["house_fuse_box"],
  "regular-clean-house": ["house_regular_clean"],
  "deep-clean-house": ["house_deep_clean"],
  "window-clean-house": ["house_window_clean"],
  "facade-clean": ["house_facade_wash"],
  "drain-house": ["house_drain_clog"],
  "light-house": ["house_light_point", "house_light_fixture"],
  "ev-charger": ["house_ev_charger"],
  "fuse-house": ["house_fuse_box"],
  "lawn-mowing": ["garden_lawn_mow", "house_lawn_mow"],
  hedge: ["garden_hedge_trim", "house_hedge_trim"],
  "snow-removal": ["garden_snow", "house_snow_removal"],
  "quick-wash-mc": ["mc_quick_wash"],
  "full-wash-mc": ["mc_full_wash"],
  "premium-detail-mc": ["mc_premium", "mc_detail"],
  "oil-change-mc": ["mc_oil_change"],
  "brake-change-mc": ["mc_brake", "mc_brake_service"],
  "chain-maintenance": ["mc_chain", "mc_chain_maint"],
  "tire-change-mc": ["mc_tire_change"],
  "tire-hotel-mc": ["mc_tire_hotel"],
  "puncture-mc": ["mc_puncture", "mc_puncture_fix"],
  "exterior-wash": ["car_exterior", "car_exterior_wash"],
  "interior-wash": ["car_interior", "car_interior_wash", "car_interior_clean"],

  "full-detail": ["car_full_detail", "full_detailing"],
  "oil-change-car": ["car_oil_change"],
  "air-filter": ["car_air_filter"],
  "brake-check": ["car_brake_check"],
  battery: ["car_battery"],
  "tire-change-car": ["car_tire_change"],
  "tire-hotel-car": ["car_tire_hotel"],
  "wheel-alignment": ["car_wheel_align"],
  vacuum: ["car_vacuum"],
  "deep-clean": ["car_deep_clean", "car_deep_interior"],
  "odor-removal": ["car_odor", "car_odor_removal"],
  "cat-haircut": ["cat_grooming_full", "cat_full_groom"],
  "cat-bath": ["cat_bath"],
  "cat-nails": ["cat_nail_trim", "cat_nails"],
  "cat-brush": ["cat_brushing", "cat_brush"],
  "cat-vaccine": ["cat_vaccination", "cat_vaccine"],
  "cat-health": ["cat_health_check"],
  "cat-dental": ["cat_dental"],
  "cat-sitting": ["cat_sitting"],
  "cat-boarding": ["cat_sitting"],
  "cat-transport": ["cat_transport"],
  "dog-haircut": ["dog_grooming_full", "dog_full_groom", "dog_haircut"],
  "dog-nails": ["dog_nail_trim", "dog_nails"],
  "dog-bath": ["dog_bath"],
  "dog-brush": ["dog_brushing", "dog_brush"],
  "dog-vaccine": ["dog_vaccination", "dog_vaccine"],
  "dog-health": ["dog_health_check"],
  "dog-dental": ["dog_dental"],
  obedience: ["dog_obedience"],
  tricks: ["dog_tricks"],
  "puppy-training": ["dog_puppy"],
  "puppy-class": ["dog_puppy"],
  "dog-boarding": ["dog_sitting"],
  "dog-sitting": ["dog_sitting"],
  "dog-walking": ["dog_walking"],
  "dog-transport": ["dog_transport"],
};

export function serviceIdCandidates(serviceId: string): string[] {
  const raw = String(serviceId || "").trim();
  if (!raw) return [];
  const dash = raw.replace(/_/g, "-");
  const underscore = raw.replace(/-/g, "_");
  const lower = raw.toLowerCase();
  const lowerDash = dash.toLowerCase();
  const lowerUnderscore = underscore.toLowerCase();
  const aliasIds = SERVICE_ID_ALIASES[lower] || [];
  // Reverse map: lock/sku ids like `car_exterior` → UI/DB id `exterior-wash`.
  const reverseAliasIds = Object.entries(SERVICE_ID_ALIASES)
    .filter(([, mapped]) =>
      mapped.some((id) => {
        const m = String(id || "").toLowerCase();
        return m === lower || m === lowerDash || m === lowerUnderscore;
      }),
    )
    .map(([uiId]) => uiId);
  const aliasVariants = [...aliasIds, ...reverseAliasIds].flatMap((id) => [
    id,
    id.replace(/_/g, "-"),
    id.replace(/-/g, "_"),
  ]);
  return [...new Set([raw, dash, underscore, ...aliasVariants])];
}

/** Turn machine ids (`car_exterior`) into a display label when DB name is missing. */
export function prettifyServiceIdLabel(nameOrId: string): string {
  let raw = String(nameOrId || "").trim();
  if (!raw) return "";
  if (/^[a-z0-9_-]+$/i.test(raw)) {
    const lower = raw.toLowerCase();
    for (const prefix of [
      "home_apt_",
      "home_house_",
      "vehicle_car_",
      "vehicle_mc_",
      "beauty_male_",
      "beauty_female_",
    ]) {
      if (lower.startsWith(prefix)) {
        raw = raw.slice(prefix.length);
        break;
      }
    }
  }
  const cleaned = raw.replace(/\s+([mf])$/i, "").trim();
  if (!cleaned) return "";
  if (!/^[a-z0-9_-]+$/i.test(cleaned)) return cleaned;
  return cleaned
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Prefer a real title; never show snake_case / kebab-case ids in the UI. */
export function displayServiceLabel(
  nameOrId: string | null | undefined,
  fallbackId?: string | null,
): string {
  const raw = String(nameOrId || "").trim();
  const fallback = String(fallbackId || "").trim();
  if (!raw && !fallback) return "—";
  const machineLike = /^[a-z0-9]+(?:[_-][a-z0-9]+)+$/i;
  if (raw && !machineLike.test(raw)) return raw;
  const pretty = prettifyServiceIdLabel(raw || fallback);
  return pretty || raw || fallback || "—";
}

export async function resolveCanonicalService<T = any>(
  supabase: SupabaseClient,
  serviceId: string,
  selectClause = "id, mode_id, target_id, category_id, is_active",
): Promise<T | null> {
  const candidates = serviceIdCandidates(serviceId);
  for (const id of candidates) {
    const { data } = await supabase
      .from("services")
      .select(selectClause)
      .eq("id", id)
      .maybeSingle();
    if (data) return data as T;
  }
  return null;
}

/** Resolve a human service name for payments / receipts (alias-aware). */
export async function resolveServiceDisplayName(
  supabase: SupabaseClient,
  serviceId: string | null | undefined,
): Promise<string> {
  const raw = String(serviceId || "").trim();
  if (!raw) return "—";
  const service = await resolveCanonicalService<{ name?: string }>(
    supabase,
    raw,
    "id, name",
  );
  const fromDb = String(service?.name || "").trim();
  return displayServiceLabel(fromDb || raw, raw);
}

/** Batch resolve display names keyed by the original service_id values. */
export async function resolveServiceDisplayNames(
  supabase: SupabaseClient,
  serviceIds: string[],
): Promise<Map<string, string>> {
  const unique = [
    ...new Set(serviceIds.map((id) => String(id || "").trim()).filter(Boolean)),
  ];
  const result = new Map<string, string>();
  if (unique.length === 0) return result;

  const lookupIds = [
    ...new Set(unique.flatMap((id) => serviceIdCandidates(id))),
  ];
  const { data: services } = await supabase
    .from("services")
    .select("id, name")
    .in("id", lookupIds.length ? lookupIds : ["__none__"]);

  const nameById = new Map(
    (services ?? []).map((s) => [
      String(s.id),
      String(s.name || "").trim(),
    ]),
  );

  for (const sid of unique) {
    let name = "";
    for (const candidate of serviceIdCandidates(sid)) {
      const hit = nameById.get(candidate);
      if (hit) {
        name = hit;
        break;
      }
    }
    result.set(sid, displayServiceLabel(name || sid, sid));
  }
  return result;
}
