import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getUserIdFromBearer } from "@/lib/supabase/route-user";
import {
  resolveCustomerDestination,
  resolveProviderNavigationOrigin,
  type CustomerDestinationSource,
} from "@/lib/maps/resolve-customer-destination";
import type { LatLng } from "@/lib/geo";

const ACTIVE_STATUSES = [
  "assigned",
  "en_route",
  "arrived",
  "in_progress",
] as const;

function readLatLng(
  lat: unknown,
  lng: unknown,
): LatLng | null {
  const la = Number(lat);
  const ln = Number(lng);
  return Number.isFinite(la) && Number.isFinite(ln) ? { lat: la, lng: ln } : null;
}

/** Customer delivery destination for provider navigation (order + live GPS + match distance). */
export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient();
    const userId = await getUserIdFromBearer(supabase, req);
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const orderId = String(req.nextUrl.searchParams.get("order_id") || "").trim();
    if (!orderId) {
      return NextResponse.json(
        { ok: false, error: "MISSING_ORDER_ID" },
        { status: 400 },
      );
    }

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select(
        "id, customer_id, provider_id, status, delivery_mode, customer_lat, customer_lng",
      )
      .eq("id", orderId)
      .maybeSingle();

    if (orderErr || !order) {
      return NextResponse.json(
        { ok: false, error: "ORDER_NOT_FOUND" },
        { status: 404 },
      );
    }

    const customerId = String(order.customer_id || "");
    const providerId = String(order.provider_id || "");
    const isCustomer = userId === customerId;
    const isProvider = userId === providerId;

    if (!isCustomer && !isProvider) {
      const { data: offer } = await supabase
        .from("order_offers")
        .select("id")
        .eq("order_id", orderId)
        .eq("provider_id", userId)
        .in("status", ["pending", "accepted"])
        .limit(1)
        .maybeSingle();
      if (!offer?.id) {
        return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
      }
    }

    const status = String(order.status || "");
    if (!ACTIVE_STATUSES.includes(status as (typeof ACTIVE_STATUSES)[number])) {
      return NextResponse.json({
        ok: true,
        inactive: true,
        current_status: status,
        destination: null,
      });
    }

    const orderLoc = readLatLng(order.customer_lat, order.customer_lng);

    const [{ data: live }, { data: offer }] = await Promise.all([
      supabase
        .from("customer_realtime_locations")
        .select("lat, lng, recorded_at")
        .eq("order_id", orderId)
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      providerId
        ? supabase
            .from("order_offers")
            .select("provider_distance_km")
            .eq("order_id", orderId)
            .eq("provider_id", providerId)
            .in("status", ["pending", "accepted"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const liveLoc = readLatLng(live?.lat, live?.lng);

    let providerBaseLoc: LatLng | null = null;
    let providerLiveLoc: LatLng | null = null;
    if (providerId) {
      const [{ data: providerLive }, { data: details }] = await Promise.all([
        supabase
          .from("provider_realtime_locations")
          .select("lat, lng")
          .eq("order_id", orderId)
          .eq("provider_id", providerId)
          .maybeSingle(),
        supabase
          .from("provider_details")
          .select("lat, lng")
          .eq("id", providerId)
          .maybeSingle(),
      ]);
      providerLiveLoc = readLatLng(providerLive?.lat, providerLive?.lng);
      providerBaseLoc = readLatLng(details?.lat, details?.lng);
    }

    const matchDistanceKm = Number(offer?.provider_distance_km);
    const providerLoc = resolveProviderNavigationOrigin(
      providerBaseLoc,
      providerLiveLoc,
      orderLoc,
      Number.isFinite(matchDistanceKm) ? matchDistanceKm : null,
    );
    const deliveryMode = String(order.delivery_mode || "");
    // Provider navigation always targets the booked delivery address for home orders.
    const resolved =
      deliveryMode === "home" && orderLoc
        ? { destination: orderLoc, source: "order" as CustomerDestinationSource }
        : resolveCustomerDestination(
            orderLoc,
            liveLoc,
            providerLoc,
            Number.isFinite(matchDistanceKm) ? matchDistanceKm : null,
          );

    return NextResponse.json({
      ok: true,
      destination: resolved.destination,
      source: resolved.source as CustomerDestinationSource,
      match_distance_km: Number.isFinite(matchDistanceKm)
        ? matchDistanceKm
        : null,
      order_location: orderLoc,
      live_location: liveLoc,
      provider_base_location: providerBaseLoc,
      provider_live_location: providerLiveLoc,
      provider_location: providerLoc,
      delivery_mode: order.delivery_mode,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "DESTINATION_READ_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
