import { createAdminClient } from "@/lib/supabase/server";
import { getUserIdFromBearer } from "@/lib/supabase/route-user";
import { orderListBucket } from "@/lib/orders/order-status-ui";
import { computeActualServiceDurationMinutes } from "@/lib/orders/service-duration";
import {
  displayServiceLabel,
  resolveServiceDisplayNames,
  serviceIdCandidates,
} from "@/lib/service-id";
import { NextRequest, NextResponse } from "next/server";

function formatOrderWhen(
  iso: string | null | undefined,
  language: "en" | "no",
) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const date = d.toLocaleDateString(language === "en" ? "en-GB" : "nb-NO", {
    day: "numeric",
    month: "long",
  });
  const time = d.toLocaleTimeString(language === "en" ? "en-GB" : "nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return language === "en" ? `${date} at ${time}` : `${date} kl. ${time}`;
}

function locationModeLabel(
  mode: string | null | undefined,
  language: "en" | "no",
) {
  if (String(mode) === "home") {
    return "Delivery";
  }
  return language === "en" ? "At provider" : "Hos tilbyder";
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient();
    const userId = await getUserIdFromBearer(supabase, req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = req.nextUrl.searchParams;
    const userType = params.get("role") === "provider" ? "provider" : "customer";
    const bucketFilter = params.get("bucket") || "completed";
    const language = params.get("lang") === "en" ? "en" : "no";

    let query = supabase
      .from("orders")
      .select(
        "id, status, service_id, delivery_mode, customer_address, price, created_at, scheduled_at, accepted_at, completed_at, started_at, service_paused_total_seconds, customer_id, provider_id",
      )
      .order("completed_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(50);

    if (userType === "customer") {
      query = query.eq("customer_id", userId);
    } else {
      query = query.eq("provider_id", userId);
    }

    if (bucketFilter === "completed") {
      query = query.in("status", ["completed", "cancelled"]);
    } else if (bucketFilter === "upcoming") {
      query = query.in("status", [
        "pending",
        "offered",
        "assigned",
        "en_route",
        "arrived",
        "in_progress",
      ]);
    }

    const { data: orders, error } = await query;
    if (error) throw error;

    const rows = orders ?? [];
    const serviceIds = [
      ...new Set(rows.map((o) => String(o.service_id || "")).filter(Boolean)),
    ];
    const orderIds = rows.map((o) => o.id);
    const profileIds = [
      ...new Set(
        rows
          .map((o) =>
            userType === "customer"
              ? String(o.provider_id || "")
              : String(o.customer_id || ""),
          )
          .filter(Boolean),
      ),
    ];
    const providerIds =
      userType === "customer"
        ? [
            ...new Set(
              rows
                .map((o) => String(o.provider_id || ""))
                .filter(Boolean),
            ),
          ]
        : [];

    const serviceLookupIds = [
      ...new Set(serviceIds.flatMap((id) => serviceIdCandidates(id))),
    ];

    const [
      { data: services },
      serviceDisplayNames,
      { data: locks },
      { data: ratings },
      { data: profiles },
      { data: providerDetails },
      { data: orderAddonRows },
      { data: reportRows },
    ] = await Promise.all([
        serviceLookupIds.length
          ? supabase
              .from("services")
              .select("id, name, mode_id, target_id, category_id, duration_minutes")
              .in("id", serviceLookupIds)
          : Promise.resolve({
              data: [] as {
                id: string;
                name: string;
                mode_id: string;
                target_id: string;
                category_id: string;
                duration_minutes: number;
              }[],
            }),
        resolveServiceDisplayNames(supabase, serviceIds),
        orderIds.length
          ? supabase
              .from("booking_price_locks")
              .select(
                "order_id, provider_total, customer_total, delivery_fee, customer_service_price, provider_service_price",
              )
              .in("order_id", orderIds)
          : Promise.resolve({
              data: [] as {
                order_id: string;
                provider_total: number;
                customer_total: number;
                delivery_fee: number;
                customer_service_price: number;
                provider_service_price: number;
              }[],
            }),
        orderIds.length
          ? supabase
              .from("ratings")
              .select("order_id, rating, rater_id, ratee_id")
              .in("order_id", orderIds)
          : Promise.resolve({
              data: [] as {
                order_id: string;
                rating: number;
                rater_id: string;
                ratee_id: string;
              }[],
            }),
        profileIds.length
          ? supabase
              .from("profiles")
              .select("id, display_name")
              .in("id", profileIds)
          : Promise.resolve({
              data: [] as { id: string; display_name: string | null }[],
            }),
        providerIds.length
          ? supabase
              .from("provider_details")
              .select("id, business_name")
              .in("id", providerIds)
          : Promise.resolve({
              data: [] as { id: string; business_name: string | null }[],
            }),
        orderIds.length
          ? supabase
              .from("order_addons")
              .select(
                "order_id, addon_id, unit_price, quantity, service_addons(name)",
              )
              .in("order_id", orderIds)
          : Promise.resolve({
              data: [] as {
                order_id: string;
                addon_id: string;
                unit_price: number;
                quantity: number;
                service_addons: { name: string | null } | null;
              }[],
            }),
        userType === "customer" && orderIds.length
          ? supabase
              .from("provider_reports")
              .select("order_id")
              .eq("reporter_id", userId)
              .in("order_id", orderIds)
          : Promise.resolve({
              data: [] as { order_id: string | null }[],
            }),
      ]);

    const serviceById = new Map(
      (services ?? []).map((s) => [String(s.id), s]),
    );
    const resolveServiceRow = (serviceId: string) => {
      for (const candidate of serviceIdCandidates(serviceId)) {
        const hit = serviceById.get(candidate);
        if (hit) return hit;
      }
      return undefined;
    };
    const lockByOrderId = new Map(
      (locks ?? []).map((l) => [String(l.order_id), l]),
    );
    const orderById = new Map(rows.map((o) => [String(o.id), o]));
    const ratingByOrderId = new Map<string, number>();
    for (const row of ratings ?? []) {
      const order = orderById.get(String(row.order_id));
      if (!order) continue;
      // Rating the customer left after service — shown on customer & provider history.
      const isCustomerServiceRating =
        String(row.rater_id) === String(order.customer_id) &&
        order.provider_id &&
        String(row.ratee_id) === String(order.provider_id);
      if (isCustomerServiceRating) {
        ratingByOrderId.set(String(row.order_id), Number(row.rating));
      }
    }
    const profileNameById = new Map(
      (profiles ?? []).map((p) => [
        String(p.id),
        String(p.display_name || "").trim(),
      ]),
    );
    const providerBusinessNameById = new Map(
      (providerDetails ?? []).map((p) => [
        String(p.id),
        String(p.business_name || "").trim(),
      ]),
    );
    const addonsByOrderId = new Map<
      string,
      { id: string; name: string; price: number }[]
    >();
    for (const row of orderAddonRows ?? []) {
      const orderId = String(row.order_id || "");
      if (!orderId) continue;
      const unit = Math.round(Number(row.unit_price) || 0);
      const qty = Math.max(1, Number(row.quantity) || 1);
      const name =
        String(row.service_addons?.name || "").trim() ||
        String(row.addon_id || "Add-on");
      const line = {
        id: String(row.addon_id || name),
        name,
        price: unit * qty,
      };
      const list = addonsByOrderId.get(orderId) ?? [];
      list.push(line);
      addonsByOrderId.set(orderId, list);
    }

    const reportedOrderIds = new Set(
      (reportRows ?? [])
        .map((r) => String(r.order_id || "").trim())
        .filter(Boolean),
    );

    const resolveCounterpartyName = (
      counterpartyId: string | null | undefined,
    ): string | null => {
      const id = String(counterpartyId || "").trim();
      if (!id) return null;
      if (userType === "customer") {
        const businessName = providerBusinessNameById.get(id);
        const displayName = profileNameById.get(id);
        return businessName || displayName || null;
      }
      return profileNameById.get(id) || null;
    };

    const enriched = rows.map((o) => {
      const status = String(o.status || "");
      const bucket = orderListBucket(status);
      const serviceId = String(o.service_id || "");
      const service = resolveServiceRow(serviceId);
      const lock = lockByOrderId.get(String(o.id));
      const whenIso =
        o.completed_at ||
        o.scheduled_at ||
        o.accepted_at ||
        o.created_at;
      const counterpartyId =
        userType === "customer" ? o.provider_id : o.customer_id;
      const counterpartyName = resolveCounterpartyName(
        counterpartyId ? String(counterpartyId) : null,
      );
      const displayPrice =
        userType === "provider"
          ? Number(lock?.provider_total) || Number(o.price) || 0
          : Number(lock?.customer_total) || Number(o.price) || 0;
      const servicePrice =
        userType === "provider"
          ? Math.round(
              Number(lock?.provider_service_price) ||
                Number(o.price) ||
                displayPrice,
            )
          : Math.round(
              Number(lock?.customer_service_price) ||
                Math.max(0, displayPrice - Number(lock?.delivery_fee || 0)),
            );
      const deliveryFee =
        String(o.delivery_mode) === "home"
          ? Math.round(Number(lock?.delivery_fee) || 0)
          : 0;
      const actualDurationMinutes = computeActualServiceDurationMinutes(o);

      const providerId =
        o.provider_id != null ? String(o.provider_id) : null
      const isReported =
        userType === "customer" && reportedOrderIds.has(String(o.id))
      return {
        id: o.id,
        status,
        bucket,
        service_id: o.service_id,
        service_name:
          serviceDisplayNames.get(serviceId) ||
          displayServiceLabel(service?.name || serviceId, serviceId),
        counterparty_name: counterpartyName,
        provider_id: providerId,
        mode_id: String(service?.mode_id || "beauty"),
        target_id: String(service?.target_id || ""),
        category_id: String(service?.category_id || "haircut"),
        price: Math.round(displayPrice),
        service_price: servicePrice,
        delivery_fee: deliveryFee,
        addons: addonsByOrderId.get(String(o.id)) ?? [],
        estimated_duration_minutes: Number(service?.duration_minutes) || 0,
        actual_duration_minutes: actualDurationMinutes,
        delivery_mode: o.delivery_mode,
        customer_rating: ratingByOrderId.get(String(o.id)) ?? null,
        ui_when: formatOrderWhen(whenIso, language),
        location_label: locationModeLabel(o.delivery_mode, language),
        can_order_again:
          userType === "customer" && status.toLowerCase() === "completed",
        can_report:
          userType === "customer" &&
          !!providerId &&
          ["completed", "cancelled"].includes(status.toLowerCase()) &&
          !isReported,
        is_reported: isReported,
      };
    });

    return NextResponse.json({ orders: enriched, role: userType });
  } catch (error) {
    console.error("[orders/list]", error);
    return NextResponse.json(
      { error: "Failed to fetch orders" },
      { status: 500 },
    );
  }
}
