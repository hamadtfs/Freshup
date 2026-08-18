"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronLeft,
  CreditCard,
  Download,
  ExternalLink,
  Headphones,
  Loader2,
  Receipt,
  Truck,
} from "lucide-react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { loginToBookCopy } from "@/lib/auth/login-required-copy";
import { formatDisplayPrice } from "@/lib/pricing/format-display-kr";
import { displayServiceLabel } from "@/lib/service-id";

type TransactionDetail = {
  id: string;
  order_id: string | null;
  service_name: string;
  total: number;
  amount: number;
  delivery_fee: number;
  currency: string;
  status: string;
  payment_method: string | null;
  receipt_url: string | null;
  ui_date: string;
  ui_time: string;
  invoice_reference: string;
};

function formatAmount(amount: number, currency: string, language: "no" | "en") {
  if (language === "en" && currency.toLowerCase() === "nok") {
    return formatDisplayPrice(amount, "en");
  }
  const cur = currency.toLowerCase() === "nok" ? "kr" : currency;
  return `${Math.round(amount)} ${cur}`;
}

function TransactionDetailSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-4 w-40 rounded bg-muted" />

      <div className="h-3 w-20 rounded bg-muted" />

      <div className="bg-card border border-border rounded-xl divide-y divide-border">
        {[1, 2].map((row) => (
          <div key={row} className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-muted" />
              <div className="h-4 w-28 rounded bg-muted" />
            </div>
            <div className="h-4 w-16 rounded bg-muted" />
          </div>
        ))}
      </div>

      <div className="h-3 w-32 rounded bg-muted pt-2" />

      <div className="bg-card border border-border rounded-xl divide-y divide-border">
        {[1, 2].map((row) => (
          <div key={row} className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-muted" />
              <div className="h-4 w-32 rounded bg-muted" />
            </div>
            <div className="h-4 w-4 rounded bg-muted" />
          </div>
        ))}
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-muted shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-36 rounded bg-muted" />
            <div className="h-3 w-48 rounded bg-muted" />
          </div>
        </div>
      </div>
    </div>
  );
}

interface TransactionDetailPageProps {
  transactionId: string;
  onBack: () => void;
  language?: "no" | "en";
}

export default function TransactionDetailPage({
  transactionId,
  onBack,
  language = "no",
}: TransactionDetailPageProps) {
  const isEn = language === "en";
  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const getToken = useCallback(async () => {
    const supabase = createBrowserSupabaseClient() as {
      auth: {
        getSession: () => Promise<{
          data: { session?: { access_token?: string } | null };
        }>;
      };
    };
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token ?? null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        if (!token) {
          if (!cancelled) {
            setError(loginToBookCopy(isEn));
          }
          return;
        }
        const url = new URL(
          `/api/payments/history/${encodeURIComponent(transactionId)}`,
          window.location.origin,
        );
        url.searchParams.set("lang", language);
        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (!cancelled) {
            setError(
              String(
                data?.error ||
                  (isEn
                    ? "Could not load transaction"
                    : "Kunne ikke hente transaksjon"),
              ),
            );
          }
          return;
        }
        if (!cancelled) {
          setDetail(data.transaction ?? null);
        }
      } catch {
        if (!cancelled) {
          setError(
            isEn
              ? "Could not load transaction"
              : "Kunne ikke hente transaksjon",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken, isEn, language, transactionId]);

  const downloadInvoice = async () => {
    setDownloading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const url = new URL(
        `/api/payments/history/${encodeURIComponent(transactionId)}/invoice`,
        window.location.origin,
      );
      url.searchParams.set("lang", language);
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `freshup-invoice-${detail?.invoice_reference || transactionId.slice(0, 8)}.html`;
      anchor.click();
      URL.revokeObjectURL(href);
    } finally {
      setDownloading(false);
    }
  };

  const paymentSupportHref = detail
    ? `mailto:support@freshup.app?subject=${encodeURIComponent(
        isEn
          ? `Payment help · ${detail.invoice_reference}`
          : `Betalingshjelp · ${detail.invoice_reference}`,
      )}`
    : "mailto:support@freshup.app";

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
          {isEn ? "Payment details" : "Betalingsdetaljer"}
        </h1>
        <div className="w-10" />
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-6">
        {loading ? (
          <TransactionDetailSkeleton />
        ) : error ? (
          <p className="text-sm text-red-600 text-center py-8">{error}</p>
        ) : !detail ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            {isEn ? "Transaction not found" : "Transaksjon ikke funnet"}
          </p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {displayServiceLabel(detail.service_name)}
            </p>

            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {isEn ? "Payment" : "Betaling"}
            </p>

            <div className="bg-card border border-border rounded-xl divide-y divide-border">
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-muted rounded-lg flex items-center justify-center">
                    <Truck className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <span className="text-sm text-foreground">
                    {isEn ? "Delivery fee" : "Delivery-tillegg"}
                  </span>
                </div>
                <span className="text-sm font-semibold text-foreground">
                  {formatAmount(detail.delivery_fee, detail.currency, language)}
                </span>
              </div>

              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-muted rounded-lg flex items-center justify-center">
                    <CreditCard className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <span className="text-sm text-foreground">
                    {isEn ? "Payment method" : "Betalingsmetode"}
                  </span>
                </div>
                <span className="text-sm font-semibold text-foreground text-right">
                  {detail.payment_method ||
                    (isEn ? "Not available" : "Ikke tilgjengelig")}
                </span>
              </div>
            </div>

            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2">
              {isEn ? "Receipt & invoice" : "Kvittering og faktura"}
            </p>

            <div className="bg-card border border-border rounded-xl divide-y divide-border">
              {detail.receipt_url ? (
                <a
                  href={detail.receipt_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-4 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-muted rounded-lg flex items-center justify-center">
                      <Receipt className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <span className="text-sm font-medium text-foreground">
                      {isEn ? "View receipt" : "Se kvittering"}
                    </span>
                  </div>
                  <ExternalLink className="h-4 w-4 text-muted-foreground" />
                </a>
              ) : (
                <div className="flex items-center gap-3 p-4 text-muted-foreground">
                  <div className="w-9 h-9 bg-muted rounded-lg flex items-center justify-center">
                    <Receipt className="h-4 w-4" />
                  </div>
                  <span className="text-sm">
                    {isEn
                      ? "Receipt will appear after charge completes"
                      : "Kvittering vises når belastningen er fullført"}
                  </span>
                </div>
              )}

              <button
                type="button"
                onClick={() => void downloadInvoice()}
                disabled={downloading}
                className="w-full flex items-center justify-between p-4 hover:bg-muted/40 transition-colors disabled:opacity-60"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-muted rounded-lg flex items-center justify-center">
                    {downloading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <Download className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <span className="text-sm font-medium text-foreground">
                    {isEn ? "Download invoice" : "Last ned faktura"}
                  </span>
                </div>
              </button>
            </div>

            <a
              href={paymentSupportHref}
              className="flex items-center gap-3 w-full bg-card border border-border rounded-xl p-4 hover:bg-muted/40 transition-colors"
            >
              <div className="w-9 h-9 bg-muted rounded-lg flex items-center justify-center">
                <Headphones className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-left">
                <p className="text-sm font-medium text-foreground">
                  {isEn ? "Payment support" : "Betalingshjelp"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isEn
                    ? "Get help with this charge"
                    : "Få hjelp med denne betalingen"}
                </p>
              </div>
            </a>
          </div>
        )}
      </div>
    </main>
  );
}
