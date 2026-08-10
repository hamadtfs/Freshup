import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { MAX_DISPATCH_MATCH_RADIUS_KM } from "@/lib/orders/dispatch-radius";
import type { ServiceModeId } from "@/lib/customer/types";
import { DISPATCH_PROVIDER_OFFER_TTL_MS } from "@/lib/orders/dispatchTiming";

export type DeliveryMode = "home" | "at_provider";

export interface MatchProvidersRequest {
  mode_id: string;
  target_id: string;
  category_id: string;
  service_id: string;
  service_mode_id: ServiceModeId;
  customer_lat: number;
  customer_lng: number;
  scheduled_at?: string | null;
  max_distance_km?: number;
  min_rating?: number;
  /** M2 performance tier; dispatch tick runs gold → silver → bronze per batch. */
  performance_tier?: "gold" | "silver" | "bronze" | null;
  /** Exclude this customer from matches (self-booking). */
  customer_id?: string | null;
}

export interface MatchingProvider {
  provider_id: string;
  distance_km: number;
  service_rating: number;
  reason_codes?: string[] | null;
  is_available?: boolean | null;
  accept_rate?: number;
  completion_rate?: number;
  response_speed?: number;
}

/** Used only when `at_provider` and order has no customer coordinates (legacy / minimal payloads). */
const FALLBACK_MATCH_LAT = 59.9139;
const FALLBACK_MATCH_LNG = 10.7522;

function offerExpiresAtForOrder(order: { created_at?: unknown }) {
  const createdAtMs = new Date(String(order.created_at || "")).getTime();
  const baseMs = Math.max(
    Date.now(),
    Number.isFinite(createdAtMs) ? createdAtMs : 0,
  );
  return new Date(baseMs + 15_000).toISOString();
}

function mapMatchProviderRows(data: unknown): MatchingProvider[] {
  if (!Array.isArray(data)) return [];

  return data.map((row: any) => ({
    provider_id: String(row.provider_id),

    distance_km: Number(row.distance_km) || 0,

    service_rating: Number(row.service_rating) || 0,

    reason_codes: Array.isArray(row.reason_codes)
      ? row.reason_codes.map((v: unknown) => String(v))
      : null,

    is_available:
      typeof row.is_available === "boolean"
        ? row.is_available
        : null,

    accept_rate: Number(row.accept_rate) || 0,

    completion_rate: Number(row.completion_rate) || 0,

    response_speed: Number(row.response_speed) || 0,
  }));
}

function matchProvidersRpcBasePayload(request: MatchProvidersRequest) {
  return {
    p_mode_id: request.mode_id,
    p_target_id: request.target_id,
    p_category_id: request.category_id,
    p_service_id: request.service_id,
    p_service_mode_id: request.service_mode_id,
    p_customer_lat: request.customer_lat,
    p_customer_lng: request.customer_lng,
    p_scheduled_at: request.scheduled_at ?? null,
    p_max_distance_km: request.max_distance_km ?? MAX_DISPATCH_MATCH_RADIUS_KM,
    p_min_rating: request.min_rating ?? 2.0,
  };
}

let warnedMissingPerformanceTierRpc = false;
let warnedMissingCustomerIdRpc = false;

function isMissingPerformanceTierRpcOverload(error: {
  code?: string;
  message?: string;
  details?: string | null;
}): boolean {
  if (error.code !== "PGRST202") return false;
  const blob = `${error.message ?? ""} ${error.details ?? ""}`;
  return blob.includes("p_performance_tier");
}

function isMissingCustomerIdRpcOverload(error: {
  code?: string;
  message?: string;
  details?: string | null;
}): boolean {
  if (error.code !== "PGRST202") return false;
  const blob = `${error.message ?? ""} ${error.details ?? ""}`;
  return blob.includes("p_customer_id");
}

/** Same as matchProviders but preserves RPC errors (for dispatch_tick diagnostics). */
export async function matchProvidersWithRpcError(
  supabase: SupabaseClient,
  request: MatchProvidersRequest,
): Promise<{
  rows: MatchingProvider[];
  error: { message: string; code?: string; details?: string } | null;
  /** False when PostgREST only had the legacy RPC (no `p_performance_tier`); caller should filter by `provider_details.dispatch_performance_tier`. */
  rpcAppliesPerformanceTier: boolean;
}> {
  const base = matchProvidersRpcBasePayload(request);
  const customerId = request.customer_id?.trim() || null;
  let rpcAppliesPerformanceTier = true;
  let { data, error } = await supabase.rpc("match_providers", {
    ...base,
    p_performance_tier: request.performance_tier ?? null,
    p_customer_id: customerId,
  });

  if (error && isMissingCustomerIdRpcOverload(error)) {
    if (!warnedMissingCustomerIdRpc) {
      warnedMissingCustomerIdRpc = true;
      console.warn(
        "[matchProviders] PostgREST has no match_providers(..., p_customer_id); retrying without it until DB is migrated (20260804150000_match_providers_skill_service_mode.sql). Filtering self-match in app.",
      );
    }
    ({ data, error } = await supabase.rpc("match_providers", {
      ...base,
      p_performance_tier: request.performance_tier ?? null,
    }));
  }

  if (error && isMissingPerformanceTierRpcOverload(error)) {
    rpcAppliesPerformanceTier = false;
    if (!warnedMissingPerformanceTierRpc) {
      warnedMissingPerformanceTierRpc = true;
      console.warn(
        "[matchProviders] PostgREST has no match_providers(..., p_performance_tier); retrying without tier until DB is migrated (e.g. 20260430152000_match_providers_tier_null_safe.sql).",
      );
    }
    ({ data, error } = await supabase.rpc("match_providers", base));
  }

  if (error) {
    console.error("[matchProviders] rpc error:", error);
    return {
      rows: [],
      error: {
        message: error.message,
        code: error.code,
        details: (error as any).details ?? undefined,
      },
      rpcAppliesPerformanceTier: true,
    };
  }

  let rows = mapMatchProviderRows(data);
  if (customerId) {
    rows = rows.filter((p) => p.provider_id !== customerId);
  }

  return {
    rows,
    error: null,
    rpcAppliesPerformanceTier,
  };
}

export async function matchProviders(
  supabase: SupabaseClient,
  request: MatchProvidersRequest,
): Promise<MatchingProvider[]> {
  const { rows, error } = await matchProvidersWithRpcError(supabase, request);
  if (error) return [];
  return rows;
}

export type DispatchOrderResult =
  | {
      ok: true;
      offers_count: number;
      providers: MatchingProvider[];
    }
  | {
      ok: false;
      error:
        | "ORDER_NOT_FOUND"
        | "ORDER_NOT_DISPATCHABLE"
        | "SERVICE_NOT_FOUND"
        | "CUSTOMER_LOCATION_REQUIRED"
        | "OFFERS_INSERT_FAILED"
        | "ORDER_UPDATE_FAILED";
      detail?: string;
      code?: string;
    };

function resolveCustomerCoords(order: {
  customer_lat: unknown;
  customer_lng: unknown;
  delivery_mode: unknown;
}): { lat: number; lng: number } | null {
  const lat = Number(order.customer_lat);
  const lng = Number(order.customer_lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng };
  }
  if (order.delivery_mode === "at_provider") {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "[dispatch_order] at_provider order missing customer_lat/lng; using Oslo centroid for distance matching",
      );
    }
    return { lat: FALLBACK_MATCH_LAT, lng: FALLBACK_MATCH_LNG };
  }
  return null;
}

/**
 * Loads order + service, runs matchProviders, inserts order_offers and sets status to offered when matches exist.
 * Clears existing pending offers for the order before inserting (safe re-dispatch).
 */
export async function dispatchOrderById(
  orderId: string,
): Promise<DispatchOrderResult> {
  const supabase = createAdminClient();

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();
  if (orderErr || !order) return { ok: false, error: "ORDER_NOT_FOUND" };
  if (order.status !== "pending") {
    return { ok: false, error: "ORDER_NOT_DISPATCHABLE" };
  }

  const { data: service, error: serviceErr } = await supabase
    .from("services")
    .select("id, mode_id, target_id, category_id, duration_minutes")
    .eq("id", order.service_id)
    .single();

  if (serviceErr || !service) {
    return { ok: false, error: "SERVICE_NOT_FOUND" };
  }

  const coords = resolveCustomerCoords(order);
  if (!coords) {
    return { ok: false, error: "CUSTOMER_LOCATION_REQUIRED" };
  }

  const matches = await matchProviders(supabase, {
    mode_id: service.mode_id,
    target_id: service.target_id,
    category_id: service.category_id,
    service_id: service.id,
    service_mode_id: order.delivery_mode === "home" ? "home" : "provider",
    customer_lat: coords.lat,
    customer_lng: coords.lng,
    scheduled_at: order.scheduled_at,
    max_distance_km: 10,
    min_rating: 2.0,
    customer_id: order.customer_id ? String(order.customer_id) : null,
  });

  if (matches.length > 0) {
    const { error: delErr } = await supabase
      .from("order_offers")
      .delete()
      .eq("order_id", orderId)
      .eq("status", "pending");

    if (delErr) {
      console.error("[dispatch_order] clear pending offers:", delErr);
      return {
        ok: false,
        error: "OFFERS_INSERT_FAILED",
        detail: delErr.message,
        code: delErr.code,
      };
    }

    const rows = matches.map((p) => ({
      order_id: orderId,
      provider_id: p.provider_id,
      status: "pending",
      offered_price: order.price ?? null,
      provider_distance_km: Number(p.distance_km.toFixed(3)),
      expires_at: new Date(
        Date.now() + DISPATCH_PROVIDER_OFFER_TTL_MS,
      ).toISOString(),
    }));
    const { error: offerErr } = await supabase
      .from("order_offers")
      .insert(rows);
    if (offerErr) {
      console.error("[dispatch_order] order_offers insert:", offerErr);
      return {
        ok: false,
        error: "OFFERS_INSERT_FAILED",
        detail: offerErr.message,
        code: offerErr.code,
      };
    }

    void import("@/lib/notifications/expo-push").then(({ notifyUsers }) =>
      notifyUsers({
        userIds: rows.map((r) => r.provider_id),
        title: "New job offer",
        body: "A nearby customer needs help. Open Fresh Up to accept.",
        data: {
          type: "new_offer",
          order_id: orderId,
        },
      }),
    );

    const { data: updatedRows, error: orderUpdErr } = await supabase
      .from("orders")
      .update({ status: "offered" })
      .eq("id", orderId)
      .eq("status", "pending")
      .select("id");

    if (orderUpdErr) {
      console.error("[dispatch_order] orders update:", orderUpdErr);
      await supabase
        .from("order_offers")
        .delete()
        .eq("order_id", orderId)
        .eq("status", "pending");
      return {
        ok: false,
        error: "ORDER_UPDATE_FAILED",
        detail: orderUpdErr.message,
        code: orderUpdErr.code,
      };
    }

    if (!updatedRows?.length) {
      await supabase
        .from("order_offers")
        .delete()
        .eq("order_id", orderId)
        .eq("status", "pending");
      return {
        ok: false,
        error: "ORDER_UPDATE_FAILED",
        detail: "Order was no longer pending (concurrent update)",
      };
    }
  }

  return { ok: true, offers_count: matches.length, providers: matches };
}

// Function to calculate accept rate
function calculateAcceptRate(accepted: number, received: number): number {
  return received > 0 ? (accepted / received) * 100 : 0;
}

// Function to calculate completion rate
function calculateCompletionRate(completed: number, received: number): number {
  return received > 0 ? (completed / received) * 100 : 0;
}

// Function to calculate response speed points
function calculateResponseSpeedPoints(responseTimes: number[], received: number): number {
  let totalPoints = 0;

  responseTimes.forEach((time) => {
    if (time <= 3) {
      totalPoints += 1; // Gold window
    } else if (time <= 6) {
      totalPoints += 0.5; // Silver window
    } else if (time <= 9) {
      totalPoints += 0.25; // Bronze window
    } else {
      totalPoints += 0; // No points
    }
  });

  return received > 0 ? (totalPoints / received) * 100 : 0;
}

// Function to calculate final tier score
function calculateFinalTierScore(acceptRate: number, completionRate: number, responseSpeed: number): number {
  return (acceptRate + completionRate + responseSpeed) / 3;
}

// Example usage
// const acceptRate = calculateAcceptRate(80, 100);
// const completionRate = calculateCompletionRate(70, 100);
// const responseSpeed = calculateResponseSpeedPoints([3, 6, 9, 2], 100);
// const finalScore = calculateFinalTierScore(acceptRate, completionRate, responseSpeed);
