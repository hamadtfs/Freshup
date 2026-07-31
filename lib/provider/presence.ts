import type { SupabaseClient } from "@supabase/supabase-js";

/** How long after last heartbeat a provider still counts as online. */
export const PROVIDER_PRESENCE_STALE_MS = 3 * 60 * 1000;

/** Client heartbeat cadence while the provider toggle is on. */
export const PROVIDER_HEARTBEAT_INTERVAL_MS = 45_000;

type AnyClient = SupabaseClient;

export function providerPresenceCutoffIso(now = Date.now()): string {
  return new Date(now - PROVIDER_PRESENCE_STALE_MS).toISOString();
}

export function isProviderPresenceFresh(
  lastOnlineAt: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!lastOnlineAt) return false;
  const t = new Date(lastOnlineAt).getTime();
  if (!Number.isFinite(t)) return false;
  return now - t <= PROVIDER_PRESENCE_STALE_MS;
}

/**
 * Mark providers offline when their heartbeat went stale (app killed / left
 * without toggling off). Safe to call from crons and demand-zone refresh.
 */
export async function markStaleProvidersOffline(
  supabase: AnyClient,
): Promise<number> {
  const cutoff = providerPresenceCutoffIso();
  const { data, error } = await supabase
    .from("provider_details")
    .update({ is_online: false })
    .eq("is_online", true)
    .or(`last_online_at.is.null,last_online_at.lt.${cutoff}`)
    .select("id");

  if (error) {
    console.error("[provider-presence] stale offline sweep failed:", error);
    return 0;
  }
  return Array.isArray(data) ? data.length : 0;
}
