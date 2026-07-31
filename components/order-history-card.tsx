"use client";

import { cn } from "@/lib/utils";
import { Clock, Flag, Headphones, Star } from "lucide-react";
import { formatDbOrderStatusLabel } from "@/lib/orders/order-status-ui";
import { formatDisplayPrice } from "@/lib/pricing/format-display-kr";
import { displayServiceLabel } from "@/lib/service-id";
import { Button } from "@/components/ui/button";

export type OrderAgainPayload = {
  service_id: string;
  delivery_mode: string;
  mode_id: string;
  target_id: string;
  category_id: string;
};

export type OrderHistoryAddonLine = {
  id: string;
  name: string;
  price: number;
};

export type OrderHistoryCardData = {
  id: string;
  status: string;
  service_name: string;
  counterparty_name: string | null;
  provider_id?: string | null;
  ui_when: string;
  location_label: string;
  price: number;
  service_price: number;
  delivery_fee: number;
  delivery_mode: string;
  addons: OrderHistoryAddonLine[];
  estimated_duration_minutes: number;
  actual_duration_minutes: number | null;
  customer_rating: number | null;
  can_order_again: boolean;
  can_report?: boolean;
  is_reported?: boolean;
  service_id: string;
  mode_id: string;
  target_id: string;
  category_id: string;
};

function statusBadgeClass(status: string) {
  const key = status.toLowerCase();
  if (key === "completed") return "bg-green-500/10 text-green-600";
  if (key === "cancelled") return "bg-red-500/10 text-red-600";
  if (["pending", "offered"].includes(key)) {
    return "bg-amber-500/10 text-amber-700";
  }
  return "bg-blue-500/10 text-blue-600";
}

function formatRatingLabel(rating: number | null) {
  if (rating == null) return null;
  return Number.isInteger(rating) ? String(rating) : rating.toFixed(1);
}

export function OrderHistoryCardSkeleton() {
  return (
    <div className="bg-card border border-border rounded-xl p-4 animate-pulse">
      <div className="flex items-start justify-between mb-3">
        <div className="space-y-2 flex-1">
          <div className="h-4 w-2/5 rounded bg-muted" />
          <div className="h-3 w-1/4 rounded bg-muted" />
        </div>
        <div className="h-6 w-20 rounded-full bg-muted" />
      </div>
      <div className="h-3 w-1/2 rounded bg-muted mb-3" />
      <div className="border-t border-border pt-3 space-y-2">
        <div className="h-4 w-full rounded bg-muted" />
        <div className="h-4 w-3/4 rounded bg-muted" />
        <div className="h-4 w-1/2 rounded bg-muted" />
        <div className="h-10 w-full rounded-lg bg-muted mt-2" />
      </div>
    </div>
  );
}

export default function OrderHistoryCard({
  order,
  language = "no",
  onOrderAgain,
  onOpenSupport,
  onReportProvider,
}: {
  order: OrderHistoryCardData;
  language?: "no" | "en";
  onOrderAgain?: (payload: OrderAgainPayload) => void;
  onOpenSupport?: () => void;
  onReportProvider?: (order: OrderHistoryCardData) => void;
}) {
  const isEn = language === "en";
  const isHomeDelivery = String(order.delivery_mode) === "home";

  const orderAgainPayload: OrderAgainPayload = {
    service_id: order.service_id,
    delivery_mode: order.delivery_mode,
    mode_id: order.mode_id,
    target_id: order.target_id,
    category_id: order.category_id,
  };

  return (
    <article className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            {displayServiceLabel(order.service_name, order.service_id)}
          </h3>
          {order.counterparty_name ? (
            <p className="text-xs text-muted-foreground">
              {order.counterparty_name}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1.5 max-w-[45%] shrink-0">
          {order.is_reported ? (
            <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-orange-500/10 text-orange-700 leading-tight">
              {isEn ? "Reported" : "Rapportert"}
            </span>
          ) : null}
          <span
            className={cn(
              "px-2.5 py-1 rounded-full text-[11px] font-semibold text-right leading-tight",
              statusBadgeClass(order.status),
            )}
          >
            {formatDbOrderStatusLabel(order.status, language)}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
        <Clock className="h-3.5 w-3.5 shrink-0" />
        <span>{order.ui_when}</span>
      </div>

      {/* Confirm-booking-style summary (order-history theme) */}
      <div className="border-t border-border pt-3 space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {order.customer_rating != null ? (
                <>
                  <Star className="h-3 w-3 fill-current text-yellow-500 shrink-0" />
                  <span className="font-medium text-foreground tabular-nums">
                    {formatRatingLabel(order.customer_rating)}
                  </span>
                  <span>•</span>
                </>
              ) : (
                <>
                  <span className="text-xs">
                    {isEn ? "Not rated" : "Ikke vurdert"}
                  </span>
                  <span>•</span>
                </>
              )}
              <span>
                {order.actual_duration_minutes != null
                  ? `${order.actual_duration_minutes} ${isEn ? "min" : "min"}`
                  : isEn
                    ? "—"
                    : "—"}
              </span>
            </div>
          </div>
          <div className="font-bold text-lg text-foreground tabular-nums shrink-0">
            {formatDisplayPrice(order.service_price, language)}
          </div>
        </div>

        {order.addons.length > 0 ? (
          <div className="border-t border-border pt-3">
            <h4 className="text-sm font-medium text-foreground mb-2">
              {isEn ? "Add-ons" : "Tillegg"}
            </h4>
            <div className="space-y-1">
              {order.addons.map((addon) => (
                <div
                  key={addon.id}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-muted-foreground">{addon.name}</span>
                  <span className="font-medium text-foreground">
                    +{formatDisplayPrice(addon.price, language)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="border-t border-border pt-3 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {isEn ? "Location" : "Sted"}
            </span>
            <span className="font-medium text-foreground">
              {order.location_label}
            </span>
          </div>
          {isHomeDelivery ? (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Delivery
              </span>
              <span className="font-medium text-foreground">
                {formatDisplayPrice(order.delivery_fee, language)}
              </span>
            </div>
          ) : null}
        </div>

        {order.can_report && onReportProvider ? (
          <div className="border-t border-border pt-3">
            <button
              type="button"
              className="flex items-center justify-between text-sm w-full text-left rounded-lg -mx-1 px-1 py-1.5 transition-colors hover:bg-muted/60 hover:text-foreground group"
              onClick={() => onReportProvider(order)}
            >
              <span className="text-muted-foreground transition-colors group-hover:text-foreground">
                {isEn ? "Report provider" : "Rapporter tilbyder"}
              </span>
              <Flag className="h-4 w-4 text-muted-foreground shrink-0 transition-colors group-hover:text-foreground" />
            </button>
          </div>
        ) : null}

        {onOpenSupport ? (
          <div className="border-t border-border pt-3">
            <button
              type="button"
              className="flex items-center justify-between text-sm w-full text-left rounded-lg -mx-1 px-1 py-1.5 transition-colors hover:bg-muted/60 hover:text-foreground group"
              onClick={onOpenSupport}
            >
              <span className="text-muted-foreground transition-colors group-hover:text-foreground">
                {isEn ? "Get help" : "Få hjelp"}
              </span>
              <Headphones className="h-4 w-4 text-muted-foreground shrink-0 transition-colors group-hover:text-foreground" />
            </button>
          </div>
        ) : null}

        <div className="border-t border-border pt-3">
          <div className="flex items-center justify-between text-base">
            <span className="font-semibold text-foreground">
              {isEn ? "Total" : "Totalt"}
            </span>
            <span className="font-bold text-lg text-foreground tabular-nums">
              {formatDisplayPrice(order.price, language)}
            </span>
          </div>
        </div>

        {order.can_order_again && onOrderAgain ? (
          <Button
            type="button"
            variant="outline"
            className="w-full h-11 rounded-xl font-semibold"
            onClick={() => onOrderAgain(orderAgainPayload)}
          >
            {isEn ? "Order again" : "Bestill på nytt"}
          </Button>
        ) : null}
      </div>
    </article>
  );
}
