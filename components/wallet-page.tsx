"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  Wallet,
  Building2,
  CalendarClock,
  ArrowDownLeft,
  Loader2,
  Zap,
} from "lucide-react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { formatDisplayPrice } from "@/lib/pricing/format-display-kr";
import { Button } from "@/components/ui/button";

type PayoutHistoryItem = {
  id: string;
  type: string;
  amount: number;
  fee: number;
  label: string;
  date: string;
  time: string;
};

type WalletData = {
  available_balance: number;
  instant_payout_fee: number;
  next_automatic_payout: { at: string; label: string };
  bank_account: { last4: string | null; masked: string };
  payout_history: PayoutHistoryItem[];
};

function WalletSummarySkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-14 w-48 rounded-lg bg-primary-foreground/20" />
      <div className="h-4 w-36 rounded bg-primary-foreground/20" />
      <div className="space-y-3 pt-4 border-t border-primary-foreground/20">
        <div className="h-10 rounded-xl bg-primary-foreground/20" />
        <div className="h-10 rounded-xl bg-primary-foreground/20" />
      </div>
    </div>
  );
}

function PayoutRowSkeleton() {
  return (
    <div className="bg-card border border-border rounded-2xl p-4 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-2/5 rounded bg-muted" />
          <div className="h-3 w-28 rounded bg-muted" />
        </div>
        <div className="h-4 w-16 rounded bg-muted" />
      </div>
    </div>
  );
}

interface WalletPageProps {
  onBack: () => void;
  language?: "no" | "en";
}

export default function WalletPage({
  onBack,
  language = "no",
}: WalletPageProps) {
  const isEn = language === "en";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [showInstantSheet, setShowInstantSheet] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const formatPrice = (price: number) => formatDisplayPrice(price, language);

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setError(isEn ? "Please sign in" : "Logg inn for å se lommebok");
        setWallet(null);
        return;
      }

      const url = new URL("/api/provider/wallet", window.location.origin);
      url.searchParams.set("lang", language);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          String(
            data?.error ||
              (isEn ? "Could not load wallet" : "Kunne ikke hente lommebok"),
          ),
        );
        return;
      }

      setWallet(data as WalletData);
    } catch {
      setError(isEn ? "Could not load wallet" : "Kunne ikke hente lommebok");
    } finally {
      setLoading(false);
    }
  }, [getToken, isEn, language]);

  useEffect(() => {
    void load();
  }, [load]);

  const availableBalance = wallet?.available_balance ?? 0;
  const instantFee = wallet?.instant_payout_fee ?? 10;
  const netInstant = Math.max(0, availableBalance - instantFee);
  const canInstantPayout = availableBalance > instantFee;

  const handleConfirmInstantPayout = async () => {
    setConfirming(true);
    setConfirmError(null);
    try {
      const token = await getToken();
      if (!token) {
        setConfirmError(isEn ? "Please sign in" : "Logg inn");
        return;
      }

      const url = new URL(
        "/api/provider/wallet/instant-payout",
        window.location.origin,
      );
      url.searchParams.set("lang", language);

      const res = await fetch(url.toString(), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setConfirmError(
          String(
            data?.error ||
              (isEn
                ? "Could not process payout"
                : "Kunne ikke gjennomføre utbetaling"),
          ),
        );
        return;
      }

      setShowInstantSheet(false);
      await load();
    } catch {
      setConfirmError(
        isEn ? "Could not process payout" : "Kunne ikke gjennomføre utbetaling",
      );
    } finally {
      setConfirming(false);
    }
  };

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
          {isEn ? "Wallet" : "Lommebok"}
        </h1>
        <div className="w-10" />
      </div>

      <div className="flex-1 overflow-y-auto pb-8">
        <div className="bg-primary mx-4 rounded-2xl p-5 text-primary-foreground mb-4">
          {loading ? (
            <WalletSummarySkeleton />
          ) : (
            <>
              <div className="flex items-center gap-2 mb-2 opacity-80">
                <Wallet className="h-4 w-4" />
                <p className="text-sm">
                  {isEn ? "Available balance" : "Tilgjengelig saldo"}
                </p>
              </div>
              <p className="text-5xl font-bold tracking-tight">
                {formatPrice(availableBalance)}
              </p>

              <div className="space-y-3 mt-6 pt-4 border-t border-primary-foreground/20">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary-foreground/20 flex items-center justify-center">
                    <CalendarClock className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-xs text-primary-foreground/70">
                      {isEn ? "Next automatic payout" : "Neste automatiske utbetaling"}
                    </p>
                    <p className="text-sm font-semibold">
                      {wallet?.next_automatic_payout.label ?? "—"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary-foreground/20 flex items-center justify-center">
                    <Building2 className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-xs text-primary-foreground/70">
                      {isEn ? "Bank account" : "Bankkonto"}
                    </p>
                    <p className="text-sm font-semibold">
                      {wallet?.bank_account.masked ?? "•••• —"}
                    </p>
                  </div>
                </div>
              </div>

              <Button
                className="w-full mt-5 h-12 rounded-xl bg-primary-foreground text-primary hover:bg-primary-foreground/90 font-semibold"
                disabled={!canInstantPayout}
                onClick={() => {
                  setConfirmError(null);
                  setShowInstantSheet(true);
                }}
              >
                <Zap className="h-4 w-4 mr-2" />
                {isEn ? "Instant payout" : "Umiddelbar utbetaling"}
              </Button>
            </>
          )}
        </div>

        <div className="px-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            {isEn ? "Payout history" : "Utbetalingshistorikk"}
          </p>
          {error && (
            <p className="text-sm text-red-600 text-center py-4">{error}</p>
          )}
          {loading ? (
            <div className="space-y-2">
              <PayoutRowSkeleton />
              <PayoutRowSkeleton />
            </div>
          ) : !error && (wallet?.payout_history.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {isEn ? "No payouts yet" : "Ingen utbetalinger ennå"}
            </p>
          ) : (
            <div className="space-y-2">
              {(wallet?.payout_history ?? []).map((item) => (
                <div
                  key={item.id}
                  className="bg-card border border-border rounded-2xl p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-muted rounded-xl flex items-center justify-center shrink-0">
                      <ArrowDownLeft className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">
                        {item.label}
                      </p>
                      {item.fee > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {isEn ? `Fee: ${item.fee} NOK` : `Gebyr: ${item.fee} kr`}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-foreground">
                        -{formatPrice(item.amount)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {item.date} · {item.time}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showInstantSheet && (
        <div className="fixed inset-0 z-[200] flex items-end justify-center">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label={isEn ? "Close" : "Lukk"}
            onClick={() => !confirming && setShowInstantSheet(false)}
          />
          <div className="relative w-full max-w-md glass-morphism-strong rounded-t-3xl shadow-2xl border-0 p-5 pb-8">
            <h2 className="text-lg font-semibold text-foreground mb-4">
              {isEn ? "Instant payout" : "Umiddelbar utbetaling"}
            </h2>

            <div className="space-y-3 mb-6">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {isEn ? "Available balance" : "Tilgjengelig saldo"}
                </span>
                <span className="font-semibold">{formatPrice(availableBalance)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{isEn ? "Fee" : "Gebyr"}</span>
                <span className="font-semibold">{formatPrice(instantFee)}</span>
              </div>
              <div className="flex justify-between text-sm border-t border-border pt-3">
                <span className="text-muted-foreground">
                  {isEn ? "Amount to receive" : "Beløp du mottar"}
                </span>
                <span className="font-bold text-green-600">
                  {formatPrice(netInstant)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {isEn ? "Destination" : "Destinasjon"}
                </span>
                <span className="font-semibold">
                  {wallet?.bank_account.masked ?? "•••• —"}
                </span>
              </div>
            </div>

            {confirmError && (
              <p className="text-sm text-red-600 mb-3">{confirmError}</p>
            )}

            <Button
              className={cn(
                "w-full h-12 rounded-xl font-semibold",
                confirming && "opacity-80",
              )}
              disabled={confirming || !canInstantPayout}
              onClick={() => void handleConfirmInstantPayout()}
            >
              {confirming ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {isEn ? "Processing…" : "Behandler…"}
                </>
              ) : isEn ? (
                "Confirm payout"
              ) : (
                "Bekreft utbetaling"
              )}
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
