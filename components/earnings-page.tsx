"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  TrendingUp,
  Briefcase,
  Clock,
  ArrowDownLeft,
} from "lucide-react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { formatDisplayPrice } from "@/lib/pricing/format-display-kr";
import { displayServiceLabel } from "@/lib/service-id";

type Period = "day" | "week" | "month" | "year";

type Transaction = {
  id: string;
  kind: "earning" | "payout";
  service_name: string;
  customer_name: string;
  amount: number;
  fee: number;
  date: string;
  time: string;
};

function EarningsSummarySkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-12 w-40 rounded-lg bg-primary-foreground/20 mb-3" />
      <div className="h-4 w-28 rounded bg-primary-foreground/20" />
      <div className="flex gap-6 mt-6 pt-4 border-t border-primary-foreground/20">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary-foreground/20" />
            <div className="space-y-1.5">
              <div className="h-5 w-8 rounded bg-primary-foreground/20" />
              <div className="h-2.5 w-10 rounded bg-primary-foreground/20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EarningsTransactionSkeleton() {
  return (
    <div className="bg-card border border-border rounded-2xl p-4 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-muted shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-2/5 rounded bg-muted" />
          <div className="h-3 w-24 rounded bg-muted" />
        </div>
        <div className="space-y-2 text-right">
          <div className="h-4 w-14 rounded bg-muted ml-auto" />
          <div className="h-3 w-20 rounded bg-muted ml-auto" />
        </div>
      </div>
    </div>
  );
}

interface EarningsPageProps {
  onBack: () => void;
  language?: "no" | "en";
}

export default function EarningsPage({
  onBack,
  language = "no",
}: EarningsPageProps) {
  const isEn = language === "en";
  const [period, setPeriod] = useState<Period>("day");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState({
    total: 0,
    jobs: 0,
    avg_per_job: 0,
    hours: 0,
  });
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const formatPrice = (price: number) => formatDisplayPrice(price, language);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createBrowserSupabaseClient() as {
        auth: {
          getSession: () => Promise<{
            data: { session?: { access_token?: string } | null };
          }>;
        };
      };
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) {
        setError(isEn ? "Please sign in" : "Logg inn for å se inntjening");
        setTransactions([]);
        return;
      }

      const url = new URL("/api/provider/earnings", window.location.origin);
      url.searchParams.set("period", period);
      url.searchParams.set("lang", language);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          String(
            data?.error ||
              (isEn
                ? "Could not load earnings"
                : "Kunne ikke hente inntjening"),
          ),
        );
        return;
      }

      setSummary({
        total: Number(data?.summary?.total) || 0,
        jobs: Number(data?.summary?.jobs) || 0,
        avg_per_job: Number(data?.summary?.avg_per_job) || 0,
        hours: Number(data?.summary?.hours) || 0,
      });
      setTransactions(
        Array.isArray(data.transactions) ? data.transactions : [],
      );
    } catch {
      setError(
        isEn ? "Could not load earnings" : "Kunne ikke hente inntjening",
      );
    } finally {
      setLoading(false);
    }
  }, [isEn, language, period]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="mx-auto h-[100dvh] w-full max-w-md bg-background flex flex-col">
      <div className="flex items-center justify-between px-4 pt-14 pb-4">
        <button
          onClick={onBack}
          className="w-10 h-10 bg-muted rounded-xl flex items-center justify-center"
        >
          <ChevronLeft className="h-5 w-5 text-muted-foreground" />
        </button>
        <h1 className="text-base font-semibold text-foreground">
          {isEn ? "Earnings" : "Inntjening"}
        </h1>
        <div className="w-10" />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="bg-primary mx-4 rounded-2xl p-5 text-primary-foreground mb-4">
          <div className="flex items-center justify-between mb-4">
            <svg
              width="36"
              height="20"
              viewBox="0 0 160 80"
              className="opacity-80"
            >
              <rect
                x="4"
                y="4"
                width="152"
                height="72"
                rx="36"
                fill="none"
                stroke="currentColor"
                strokeWidth="5"
              />
              <circle cx="35" cy="40" r="16" fill="currentColor" />
              <circle cx="80" cy="40" r="16" fill="currentColor" />
              <circle cx="125" cy="40" r="16" fill="currentColor" />
            </svg>
            <div className="flex bg-primary-foreground/20 rounded-lg p-0.5">
              {(["day", "week", "month", "year"] as const).map((p) => (
                <button
                  key={p}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                    period === p
                      ? "bg-primary-foreground text-primary"
                      : "text-primary-foreground/70 hover:text-primary-foreground",
                  )}
                  onClick={() => setPeriod(p)}
                >
                  {p === "day"
                    ? "D"
                    : p === "week"
                      ? "W"
                      : p === "month"
                        ? "M"
                        : "Y"}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <EarningsSummarySkeleton />
          ) : (
            <>
              <p className="text-5xl font-bold tracking-tight">
                {formatPrice(summary.total)}
              </p>
              <p className="text-sm text-primary-foreground/70 mt-1">
                {period === "day"
                  ? isEn
                    ? "Earnings today"
                    : "Inntjening i dag"
                  : period === "week"
                    ? isEn
                      ? "This week"
                      : "Denne uken"
                    : period === "month"
                      ? isEn
                        ? "This month"
                        : "Denne måneden"
                      : isEn
                        ? "This year"
                        : "I år"}
              </p>

              <div className="flex gap-6 mt-6 pt-4 border-t border-primary-foreground/20">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-primary-foreground/20 flex items-center justify-center">
                    <Briefcase className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-lg font-bold">{summary.jobs}</p>
                    <p className="text-[10px] text-primary-foreground/60">
                      {isEn ? "Jobs" : "Oppdrag"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-primary-foreground/20 flex items-center justify-center">
                    <TrendingUp className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-lg font-bold">
                      {formatPrice(summary.avg_per_job)}
                    </p>
                    <p className="text-[10px] text-primary-foreground/60">
                      {isEn ? "Avg/job" : "Snitt"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-primary-foreground/20 flex items-center justify-center">
                    <Clock className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-lg font-bold">{summary.hours}h</p>
                    <p className="text-[10px] text-primary-foreground/60">
                      {isEn ? "Time" : "Timer"}
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="px-4 pb-8">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            {isEn ? "Earnings history" : "Inntjeningshistorikk"}
          </p>
          {error && (
            <p className="text-sm text-red-600 text-center py-4">{error}</p>
          )}
          {loading ? (
            <div className="space-y-2">
              <EarningsTransactionSkeleton />
              <EarningsTransactionSkeleton />
              <EarningsTransactionSkeleton />
            </div>
          ) : !error && transactions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {isEn
                ? "No completed jobs in this period"
                : "Ingen fullførte jobber i perioden"}
            </p>
          ) : (
            <div className="space-y-2">
              {transactions.map((tx) => {
                const isPayout = tx.kind === "payout";
                return (
                  <div
                    key={tx.id}
                    className="bg-card border border-border rounded-2xl p-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-muted rounded-xl flex items-center justify-center shrink-0">
                        {isPayout ? (
                          <ArrowDownLeft className="h-6 w-6 text-muted-foreground" />
                        ) : (
                          <Briefcase className="h-6 w-6 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">
                          {displayServiceLabel(tx.service_name)}
                        </p>
                        {tx.customer_name ? (
                          <p className="text-xs text-muted-foreground">
                            {tx.customer_name}
                          </p>
                        ) : null}
                      </div>
                      <div className="text-right">
                        <p
                          className={cn(
                            "text-sm font-bold",
                            isPayout ? "text-foreground" : "text-green-600",
                          )}
                        >
                          {isPayout ? "-" : "+"}
                          {formatPrice(tx.amount)}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {tx.date} · {tx.time}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
