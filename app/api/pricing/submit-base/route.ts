// =====================================================================
// FreshUp Pricing — provider base-price submission (spec §2.1)
// POST /api/pricing/submit-base
//
// Called from the provider signup / onboarding UI when a provider
// activates a new service. We capture:
//   • provider_id (from auth header, same convention as /api/providers/me)
//   • service_id  (from request body)
//   • price       (provider's own quote in NOK)
//   • area_id     (resolved from provider's GPS at signup, NOT user-entered)
//
// The trimmed-mean aggregate updates automatically through the
// `trg_provider_price_input_change` trigger on `provider_price_inputs`.
// =====================================================================

import { createAdminClient } from "@/lib/supabase/server";
import { resolveCanonicalService } from "@/lib/service-id";
import { resolveAreaIdFromDb } from "@/lib/pricing/server";
import { DEFAULT_CURRENCY } from "@/lib/pricing";
import { UNKNOWN_AREA_ID } from "@/lib/pricing/areas";
import { corsPreflight, withCorsHeaders } from "@/lib/api/cors";
import { NextRequest, NextResponse } from "next/server";

function json(req: NextRequest, body: unknown, init?: ResponseInit) {
  return withCorsHeaders(req, NextResponse.json(body, init));
}

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req);
}

interface SubmitBasePayload {
  service_id: string;
  price: number;
  /** Optional explicit GPS — if absent we read from provider_details. */
  lat?: number;
  lng?: number;
  source?: "signup" | "update";
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient();

    // Same auth convention used by /api/providers/me and /api/providers/onboard:
    // middleware sets `x-provider-id` after verifying the bearer token.
    const providerId = req.headers.get("x-provider-id");
    if (!providerId) {
      return json(req, { error: "Unauthorized" }, { status: 401 });
    }

    const payload = (await req.json()) as SubmitBasePayload;

    if (!payload?.service_id || typeof payload.service_id !== "string") {
      return json(req, 
        { error: "service_id is required" },
        { status: 400 },
      );
    }
    const price = Number(payload.price);
    if (!Number.isFinite(price) || price <= 0) {
      return json(req, 
        { error: "price must be a positive number" },
        { status: 400 },
      );
    }

    const canonical = await resolveCanonicalService<{ id: string }>(
      supabase,
      payload.service_id,
      "id",
    );
    if (!canonical) {
      return json(req, { error: "Service not found" }, { status: 404 });
    }

    // Resolve area: explicit lat/lng wins, else fall back to provider_details.
    let lat: number | null =
      typeof payload.lat === "number" && Number.isFinite(payload.lat)
        ? payload.lat
        : null;
    let lng: number | null =
      typeof payload.lng === "number" && Number.isFinite(payload.lng)
        ? payload.lng
        : null;
    if (lat == null || lng == null) {
      const { data: details } = await supabase
        .from("provider_details")
        .select("lat, lng")
        .eq("id", providerId)
        .maybeSingle();
      const detailsLat = (details as any)?.lat ?? null;
      const detailsLng = (details as any)?.lng ?? null;
      if (lat == null) lat = typeof detailsLat === "number" ? detailsLat : Number(detailsLat) || null;
      if (lng == null) lng = typeof detailsLng === "number" ? detailsLng : Number(detailsLng) || null;
    }

    if (lat == null || lng == null) {
      return json(req, 
        {
          error: "AREA_UNKNOWN",
          reason: "missing_coordinates",
          message:
            "Provider home or service coordinates are missing. Set a map pin on the profile first.",
        },
        { status: 422 },
      );
    }

    const { areaId, isKnown } = await resolveAreaIdFromDb(supabase, lat, lng);
    if (!isKnown || areaId === UNKNOWN_AREA_ID) {
      return json(req, 
        {
          error: "AREA_UNKNOWN",
          reason: "area_resolution_failed",
          message: "Could not resolve a pricing area for the provider coordinates.",
        },
        { status: 422 },
      );
    }

    const source = payload.source === "update" ? "update" : "signup";
    const now = new Date().toISOString();

    const { error: upsertErr } = await supabase
      .from("provider_price_inputs")
      .upsert(
        {
          provider_id: providerId,
          service_id: canonical.id,
          area_id: areaId,
          price: Number(price.toFixed(2)),
          currency: DEFAULT_CURRENCY,
          source,
          updated_at: now,
        },
        { onConflict: "provider_id,service_id" },
      );
    if (upsertErr) {
      console.error("[pricing] provider_price_inputs upsert error:", upsertErr);
      return json(req, 
        { error: "Failed to save price input" },
        { status: 500 },
      );
    }

    // Read back the freshly-recomputed aggregate (the DB trigger ran during
    // the upsert). This lets the UI immediately show "X providers contributed".
    const { data: aggregate } = await supabase
      .from("area_base_prices")
      .select("base_price, sample_size, is_active, last_computed_at")
      .eq("area_id", areaId)
      .eq("service_id", canonical.id)
      .maybeSingle();

    return json(req, {
      success: true,
      provider_id: providerId,
      service_id: canonical.id,
      area_id: areaId,
      submitted_price: Number(price.toFixed(2)),
      currency: DEFAULT_CURRENCY,
      aggregate: aggregate
        ? {
            base_price: (aggregate as any).base_price != null
              ? Number((aggregate as any).base_price)
              : null,
            sample_size: Number((aggregate as any).sample_size ?? 0),
            is_active: !!(aggregate as any).is_active,
            last_computed_at: (aggregate as any).last_computed_at ?? null,
          }
        : null,
    });
  } catch (error) {
    console.error("[pricing] submit-base error:", error);
    return json(req, 
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * GET /api/pricing/submit-base?service_id=...
 * Lightweight read so the signup UI can pre-fill the input with what
 * the provider previously submitted. Returns 404 if no row exists yet.
 */
export async function GET(req: NextRequest) {
  try {
    const providerId = req.headers.get("x-provider-id");
    if (!providerId) {
      return json(req, { error: "Unauthorized" }, { status: 401 });
    }

    const serviceId = req.nextUrl.searchParams.get("service_id");
    if (!serviceId) {
      return json(req, 
        { error: "service_id is required" },
        { status: 400 },
      );
    }

    const supabase = createAdminClient();
    const canonical = await resolveCanonicalService<{ id: string }>(
      supabase,
      serviceId,
      "id",
    );
    if (!canonical) {
      return json(req, { error: "Service not found" }, { status: 404 });
    }

    const { data, error } = await supabase
      .from("provider_price_inputs")
      .select("price, area_id, currency, source, updated_at")
      .eq("provider_id", providerId)
      .eq("service_id", canonical.id)
      .maybeSingle();
    if (error) {
      console.error("[pricing] provider_price_inputs read error:", error);
      return json(req, 
        { error: "Failed to read price input" },
        { status: 500 },
      );
    }
    if (!data) {
      return json(req, { submitted: null });
    }

    return json(req, {
      submitted: {
        price: Number((data as any).price),
        area_id: (data as any).area_id,
        currency: (data as any).currency,
        source: (data as any).source,
        updated_at: (data as any).updated_at,
      },
    });
  } catch (error) {
    console.error("[pricing] submit-base GET error:", error);
    return json(req, 
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
