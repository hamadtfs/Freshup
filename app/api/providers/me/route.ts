import {
  computeProviderPerformance,
  PERFORMANCE_ROLLING_DAYS,
  type ProviderPerformanceTier,
} from "@/lib/providers/performance-score";
import {
  normalizeAcceptingDeliveryMode,
  type AcceptingDeliveryMode,
} from "@/lib/provider/accepting-mode";
import { createAdminClient } from "@/lib/supabase/server";
import { withTransientRetry } from "@/lib/supabase/transient";
import { NextRequest, NextResponse } from "next/server";

interface ProviderProfileUpdatePayload {
  name?: string;
  phone?: string;
  email?: string;
  avatarUrl?: string;
  deliveryModes?: string[];
  /** Live accepting mode — does not change capability `delivery_modes`. */
  acceptingDeliveryMode?: AcceptingDeliveryMode | "provider";
  address?: string;
  lat?: number;
  lng?: number;
  defaultLat?: number;
  defaultLng?: number;
  defaultAddress?: string;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCoordinate(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return null;
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeAvatar(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:image/")) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeDeliveryModes(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const modes = value
    .map((v) =>
      String(v || "")
        .trim()
        .toLowerCase(),
    )
    .filter((v) => v === "home" || v === "provider" || v === "at_provider");
  return [...new Set(modes)];
}

function resolveServiceModeId(
  deliveryModes: string[],
): "home" | "provider" | "both" {
  const normalized = (deliveryModes || []).map((m) => String(m).toLowerCase());
  const hasHome = normalized.includes("home");
  const hasProvider =
    normalized.includes("provider") || normalized.includes("at_provider");
  if (hasHome && hasProvider) return "both";
  if (hasProvider) return "provider";
  return "home";
}

type ProviderTier = "gold" | "silver" | "bronze";

function tierForScore(score: number): ProviderTier {
  if (score >= 70) return "gold";
  if (score >= 50) return "silver";
  return "bronze";
}

export async function GET(req: NextRequest) {
  try {
    return await withTransientRetry(async () => {
      const supabase = createAdminClient();
      const providerId = req.headers.get("x-provider-id");

      if (!providerId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { data: provider, error } = await supabase
        .from("provider_details")
        .select("*")
        .eq("id", providerId)
        .maybeSingle();
      if (error) throw error;

      const cutoffIso = new Date(
        Date.now() - PERFORMANCE_ROLLING_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      const nowIso = new Date().toISOString();
      const [modes, targets, categories, skills, offers, pendingOffers, completedOrders] =
        await Promise.all([
          supabase
            .from("provider_modes")
            .select("mode_id")
            .eq("provider_id", providerId),
          supabase
            .from("provider_targets")
            .select("target_id")
            .eq("provider_id", providerId),
          supabase
            .from("provider_categories")
            .select("category_id")
            .eq("provider_id", providerId),
          supabase
            .from("provider_skills")
            .select("*")
            .eq("provider_id", providerId),
          supabase
            .from("order_offers")
            .select("status, created_at, responded_at, response_time_seconds")
            .eq("provider_id", providerId)
            .gte("created_at", cutoffIso),
          supabase
            .from("order_offers")
            .select(
              "id, order_id, expires_at, status, offered_price, provider_distance_km",
            )
            .eq("provider_id", providerId)
            .eq("status", "pending")
            .gt("expires_at", nowIso)
            .order("expires_at", { ascending: true }),
          supabase
            .from("orders")
            .select("status, completed_at, accepted_at")
            .eq("provider_id", providerId)
            .eq("status", "completed"),
        ]);
      if (modes.error) throw modes.error;
      if (targets.error) throw targets.error;
      if (categories.error) throw categories.error;
      if (skills.error) throw skills.error;
      if (offers.error) throw offers.error;
      if (pendingOffers.error) throw pendingOffers.error;
      if (completedOrders.error) throw completedOrders.error;

      const cutoffMs = new Date(cutoffIso).getTime();
      const offerRows = offers.data || [];
      const completedInWindow = (completedOrders.data || []).filter(
        (r: any) => {
          const at = r?.completed_at || r?.accepted_at;
          if (!at) return false;
          const ms = new Date(String(at)).getTime();
          return Number.isFinite(ms) && ms >= cutoffMs;
        },
      ).length;
      const performance = computeProviderPerformance({
        offers: offerRows.map((r: any) => ({
          status: String(r?.status || ""),
          created_at: String(r?.created_at || ""),
          responded_at: r?.responded_at ?? null,
          response_time_seconds:
            typeof r?.response_time_seconds === "number"
              ? r.response_time_seconds
              : r?.response_time_seconds != null
                ? Number(r.response_time_seconds)
                : null,
        })),
        completedJobs: completedInWindow,
        providerCreatedAt:
          (provider as { created_at?: string } | null)?.created_at ?? null,
      });

      const storedTierRaw = String(
        (provider as { dispatch_performance_tier?: string } | null)
          ?.dispatch_performance_tier || "",
      )
        .toLowerCase()
        .trim();
      const dispatchTierStored: ProviderPerformanceTier | null =
        storedTierRaw === "gold" ||
        storedTierRaw === "silver" ||
        storedTierRaw === "bronze"
          ? storedTierRaw
          : null;

      // UI + live stats always use spec §3 computed tier (matches score).
      // dispatch_performance_tier is refreshed hourly in DB; expose separately for debugging.
      if (
        dispatchTierStored !== performance.tier
      ) {
        void supabase
          .from("provider_details")
          .update({ dispatch_performance_tier: performance.tier })
          .eq("id", providerId);
      }

      return NextResponse.json({
        provider: provider || null,
        profile: null,
        modes: modes.data?.map((m: any) => m.mode_id) || [],
        targets: targets.data?.map((t: any) => t.target_id) || [],
        categories: categories.data?.map((c: any) => c.category_id) || [],
        skills: skills.data || [],
        contact: {
          name: normalizeString((provider as any)?.business_name) || "",
          phone: normalizeString((provider as any)?.phone) || "",
          email: normalizeString((provider as any)?.email) || "",
          avatarUrl: normalizeAvatar((provider as any)?.avatar_url) || "",
          address: normalizeString((provider as any)?.address) || "",
          lat: normalizeCoordinate((provider as any)?.lat),
          lng: normalizeCoordinate((provider as any)?.lng),
        },
        defaultLocation: {
          address:
            normalizeString((provider as any)?.address) ||
            "",
          lat: normalizeCoordinate((provider as any)?.lat),
          lng: normalizeCoordinate((provider as any)?.lng),
        },
        performanceStats: {
          tier: performance.tier,
          score: performance.score,
          tierIsProvisional: performance.tierIsProvisional,
          acceptRate: performance.acceptRate,
          completionRate: performance.completionRate,
          responseSpeed: performance.responseSpeed,
          received: performance.received,
          accepted: performance.accepted,
          completed: performance.completed,
          dispatchTierStored,
          responseBuckets: performance.responseBuckets,
        },
        pendingOffers: pendingOffers.data ?? [],
      });
    });
  } catch (error) {
    console.error("[v0] Get provider error:", error);
    return NextResponse.json(
      { error: "Failed to fetch provider" },
      { status: 503 },
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const supabase = createAdminClient();
    const providerId = req.headers.get("x-provider-id");

    if (!providerId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const updates = (await req.json()) as ProviderProfileUpdatePayload;
    const raw = updates as unknown as Record<string, unknown>;

    const { data: existing, error: existingErr } = await supabase
      .from("provider_details")
      .select(
        "business_name, phone, email, avatar_url, delivery_modes, accepting_delivery_mode, address, lat, lng",
      )
      .eq("id", providerId)
      .maybeSingle();
    if (existingErr) throw existingErr;

    const pickNullableString = (
      payloadKey: keyof ProviderProfileUpdatePayload,
      existingColumn: string,
      preserveExistingOnEmpty = false,
    ): string | null => {
      if (!Object.prototype.hasOwnProperty.call(raw, payloadKey as string)) {
        return normalizeString((existing as any)?.[existingColumn]);
      }
      const incoming = normalizeString((updates as any)?.[payloadKey]);
      if (incoming === null && preserveExistingOnEmpty) {
        return normalizeString((existing as any)?.[existingColumn]);
      }
      return incoming;
    };

    /** Coordinate fields: missing key → keep DB; explicit null/undefined → keep DB (avoid wiping on partial saves). */
    const pickCoord = (
      payloadKey: keyof ProviderProfileUpdatePayload,
      column: "lat" | "lng",
    ): number | null => {
      if (!Object.prototype.hasOwnProperty.call(raw, payloadKey as string)) {
        return normalizeCoordinate((existing as any)?.[column]);
      }
      const incoming = (updates as any)[payloadKey];
      if (incoming === null || incoming === undefined) {
        return normalizeCoordinate((existing as any)?.[column]);
      }
      return normalizeCoordinate(incoming);
    };

    const pickCoordWithAlias = (
      primaryKey: "lat" | "lng",
      aliasKey: "defaultLat" | "defaultLng",
      column: "lat" | "lng",
    ): number | null => {
      if (Object.prototype.hasOwnProperty.call(raw, primaryKey)) {
        return pickCoord(primaryKey, column);
      }
      if (Object.prototype.hasOwnProperty.call(raw, aliasKey)) {
        const incoming = (updates as any)[aliasKey];
        if (incoming === null || incoming === undefined) {
          return normalizeCoordinate((existing as any)?.[column]);
        }
        return normalizeCoordinate(incoming);
      }
      return normalizeCoordinate((existing as any)?.[column]);
    };

    const pickAddressWithAlias = (): string | null => {
      if (Object.prototype.hasOwnProperty.call(raw, "address")) {
        return pickNullableString("address", "address");
      }
      if (Object.prototype.hasOwnProperty.call(raw, "defaultAddress")) {
        return normalizeString((updates as any)?.defaultAddress);
      }
      return normalizeString((existing as any)?.address);
    };

    const name = pickNullableString("name", "business_name", true);
    const phone = pickNullableString("phone", "phone", true);
    const email = pickNullableString("email", "email", true);
    const avatarUrl = Object.prototype.hasOwnProperty.call(raw, "avatarUrl")
      ? normalizeAvatar(updates?.avatarUrl)
      : normalizeAvatar((existing as any)?.avatar_url);
    const address = pickAddressWithAlias();
    const deliveryModes = Object.prototype.hasOwnProperty.call(
      raw,
      "deliveryModes",
    )
      ? normalizeDeliveryModes((updates as any)?.deliveryModes)
      : Array.isArray((existing as any)?.delivery_modes)
        ? ((existing as any).delivery_modes as unknown[])
            .map((v) => String(v || "").trim())
            .filter(Boolean)
        : null;

    const hasAcceptingUpdate =
      Object.prototype.hasOwnProperty.call(raw, "acceptingDeliveryMode") ||
      Object.prototype.hasOwnProperty.call(raw, "accepting_delivery_mode");
    const acceptingDeliveryMode = hasAcceptingUpdate
      ? normalizeAcceptingDeliveryMode(
          raw.acceptingDeliveryMode ?? raw.accepting_delivery_mode,
        ) ?? "both"
      : null;

    const lat = pickCoordWithAlias("lat", "defaultLat", "lat");
    const lng = pickCoordWithAlias("lng", "defaultLng", "lng");

    if (email && !isValidEmail(email)) {
      return NextResponse.json(
        { error: "Invalid email address" },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();

    const { error: detailsErr } = await supabase
      .from("provider_details")
      .upsert(
        {
          id: providerId,
          business_name: name,
          phone,
          email,
          avatar_url: avatarUrl,
          delivery_modes: deliveryModes,
          ...(hasAcceptingUpdate
            ? { accepting_delivery_mode: acceptingDeliveryMode }
            : {}),
          address,
          lat,
          lng,
          updated_at: now,
        },
        { onConflict: "id" },
      );
    if (detailsErr) throw detailsErr;

    if (
      Object.prototype.hasOwnProperty.call(raw, "deliveryModes") &&
      Array.isArray(deliveryModes) &&
      deliveryModes.length > 0
    ) {
      // Capabilities only — keep skills on "both" when the provider supports
      // both modes. Live accepting mode is `accepting_delivery_mode`.
      const serviceModeId = resolveServiceModeId(deliveryModes);
      const { error: skillsErr } = await supabase
        .from("provider_skills")
        .update({ service_mode_id: serviceModeId, updated_at: now })
        .eq("provider_id", providerId);
      if (skillsErr) throw skillsErr;
    }

    const { data: savedRow, error: readErr } = await supabase
      .from("provider_details")
      .select(
        "business_name, phone, email, avatar_url, delivery_modes, accepting_delivery_mode, address, lat, lng",
      )
      .eq("id", providerId)
      .maybeSingle();
    if (readErr) throw readErr;

    const row = savedRow as Record<string, unknown> | null;
    const outLat = normalizeCoordinate(row?.lat) ?? lat;
    const outLng = normalizeCoordinate(row?.lng) ?? lng;
    const outName = normalizeString(row?.business_name) ?? name ?? "";
    const outPhone = normalizeString(row?.phone) ?? phone ?? "";
    const outEmail = normalizeString(row?.email) ?? email ?? "";
    const outAvatar = normalizeAvatar(row?.avatar_url) ?? avatarUrl ?? "";
    const outAddress = normalizeString(row?.address) ?? address ?? "";
    const outAccepting =
      normalizeAcceptingDeliveryMode(row?.accepting_delivery_mode) ??
      (hasAcceptingUpdate ? acceptingDeliveryMode : null) ??
      "both";

    return NextResponse.json({
      success: true,
      provider: {
        delivery_modes: Array.isArray(row?.delivery_modes)
          ? row.delivery_modes
          : deliveryModes,
        accepting_delivery_mode: outAccepting,
      },
      contact: {
        name: outName || "",
        phone: outPhone || "",
        email: outEmail || "",
        avatarUrl: outAvatar || "",
        address: outAddress || "",
        lat: outLat,
        lng: outLng,
      },
      defaultLocation: {
        address: outAddress || "",
        lat: outLat,
        lng: outLng,
      },
      acceptingDeliveryMode: outAccepting,
    });
  } catch (error) {
    console.error("[v0] Update provider error:", error);
    return NextResponse.json(
      { error: "Failed to update provider" },
      { status: 500 },
    );
  }
}
