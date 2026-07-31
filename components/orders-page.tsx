"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, Calendar } from "lucide-react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import OrderHistoryCard, {
  OrderHistoryCardSkeleton,
  type OrderHistoryCardData,
  type OrderAgainPayload,
} from "@/components/order-history-card";

export type { OrderAgainPayload };

interface OrdersPageProps {
  onBack: () => void;
  language?: "no" | "en";
  userType?: "customer" | "provider";
  onOrderAgain?: (payload: OrderAgainPayload) => void;
  onOpenSupport?: () => void;
  onReportProvider?: (order: OrderHistoryCardData) => void;
}

export default function OrdersPage({
  onBack,
  language = "no",
  userType = "customer",
  onOrderAgain,
  onOpenSupport,
  onReportProvider,
}: OrdersPageProps) {
  const isEn = language === "en";
  const [orders, setOrders] = useState<OrderHistoryCardData[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);

  const getToken = useCallback(async () => {
    if (tokenRef.current) return tokenRef.current;
    const supabase = createBrowserSupabaseClient() as {
      auth: {
        getSession: () => Promise<{
          data: { session?: { access_token?: string } | null };
        }>;
      };
    };
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token ?? null;
    tokenRef.current = token;
    return token;
  }, []);

  const loadOrders = useCallback(async () => {
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setError(isEn ? "Please sign in" : "Logg inn for å se bestillinger");
        setOrders([]);
        return;
      }

      const url = new URL("/api/orders/list", window.location.origin);
      url.searchParams.set("role", userType);
      url.searchParams.set("bucket", "completed");
      url.searchParams.set("lang", language);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          String(
            data?.error ||
              (isEn ? "Could not load orders" : "Kunne ikke hente bestillinger"),
          ),
        );
        setOrders([]);
        return;
      }
      setOrders(Array.isArray(data.orders) ? data.orders : []);
    } catch {
      setError(isEn ? "Could not load orders" : "Kunne ikke hente bestillinger");
      setOrders([]);
    } finally {
      setInitialLoading(false);
    }
  }, [getToken, isEn, language, userType]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const showSkeleton = initialLoading && orders.length === 0;

  return (
    <main className="mx-auto h-[100dvh] w-full max-w-md bg-background flex flex-col">
      <div className="flex items-center justify-between px-4 pt-14 pb-4 border-b border-border">
        <button
          onClick={onBack}
          className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center"
        >
          <ChevronLeft className="h-5 w-5 text-muted-foreground" />
        </button>
        <h1 className="text-base font-semibold text-foreground">
          {isEn ? "My orders" : "Mine bestillinger"}
        </h1>
        <div className="w-10" />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 pb-8 space-y-3">
        {showSkeleton ? (
          <>
            <OrderHistoryCardSkeleton />
            <OrderHistoryCardSkeleton />
          </>
        ) : error ? (
          <div className="text-center text-sm text-red-600 py-8">{error}</div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[40vh] text-center">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
              <Calendar className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-foreground text-sm font-medium">
              {isEn ? "No completed orders yet" : "Ingen fullførte bestillinger ennå"}
            </p>
            <p className="text-muted-foreground text-xs mt-1">
              {isEn
                ? "Book a service to get started"
                : "Bestill en tjeneste for å komme i gang"}
            </p>
          </div>
        ) : (
          orders.map((order) => (
            <OrderHistoryCard
              key={order.id}
              order={order}
              language={language}
              onOrderAgain={userType === "customer" ? onOrderAgain : undefined}
              onOpenSupport={onOpenSupport}
              onReportProvider={
                userType === "customer" ? onReportProvider : undefined
              }
            />
          ))
        )}
      </div>
    </main>
  );
}
