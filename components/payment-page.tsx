"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Plus,
  Check,
  Trash2,
  Loader2,
  Receipt,
} from "lucide-react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import AddCardForm from "@/components/add-card-form";
import TransactionDetailPage from "@/components/transaction-detail-page";
import { formatDisplayPrice } from "@/lib/pricing/format-display-kr";
import { displayServiceLabel } from "@/lib/service-id";

type PaymentMethod = {
  id: string;
  kind: string;
  brand: string | null;
  last4: string | null;
  is_default: boolean;
  label: string;
};

type Transaction = {
  id: string;
  service_name: string;
  amount: number;
  total: number;
  delivery_fee: number;
  currency: string;
  status: string;
  ui_date: string;
  ui_time: string;
};

function formatAmount(amount: number, currency: string, language: "no" | "en") {
  if (language === "en" && currency.toLowerCase() === "nok") {
    return formatDisplayPrice(amount, "en");
  }
  const cur = currency.toLowerCase() === "nok" ? "kr" : currency;
  return `${Math.round(amount)} ${cur}`;
}

function PaymentMethodCardSkeleton() {
  return (
    <div className="bg-card border border-border rounded-xl p-4 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-lg bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-32 rounded bg-muted" />
          <div className="h-3 w-16 rounded bg-muted" />
        </div>
        <div className="flex gap-2">
          <div className="w-8 h-8 rounded-lg bg-muted" />
          <div className="w-8 h-8 rounded-lg bg-muted" />
        </div>
      </div>
    </div>
  );
}

function TransactionRowSkeleton() {
  return (
    <div className="bg-card border border-border rounded-xl p-4 animate-pulse">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 space-y-2">
          <div className="h-4 w-2/5 rounded bg-muted" />
          <div className="h-3 w-28 rounded bg-muted" />
          <div className="h-3 w-24 rounded bg-muted" />
        </div>
        <div className="space-y-2 text-right">
          <div className="h-4 w-14 rounded bg-muted ml-auto" />
          <div className="h-3 w-10 rounded bg-muted ml-auto" />
        </div>
      </div>
    </div>
  );
}

interface PaymentPageProps {
  onBack: () => void;
  language?: "no" | "en";
}

export default function PaymentPage({
  onBack,
  language = "no",
}: PaymentPageProps) {
  const isEn = language === "en";
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stripeConfigured, setStripeConfigured] = useState(true);
  const [showAddCard, setShowAddCard] = useState(false);
  const [addCardSecret, setAddCardSecret] = useState<string | null>(null);
  const [addCardIntentId, setAddCardIntentId] = useState<string | null>(null);
  const [addCardPreparing, setAddCardPreparing] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(true);
  const [selectedTransactionId, setSelectedTransactionId] = useState<
    string | null
  >(null);

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

  const loadMethods = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setError(isEn ? "Please sign in" : "Logg inn for å se betaling");
        setMethods([]);
        return;
      }
      setAccessToken(token);

      const res = await fetch("/api/payments/methods", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          String(
            data?.error ||
              (isEn ? "Could not load cards" : "Kunne ikke hente kort"),
          ),
        );
        setMethods([]);
        return;
      }
      setStripeConfigured(data?.stripe_configured !== false);
      setMethods(Array.isArray(data.methods) ? data.methods : []);
    } catch {
      setError(isEn ? "Could not load cards" : "Kunne ikke hente kort");
    } finally {
      setLoading(false);
    }
  }, [getToken, isEn]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const token = await getToken();
      if (!token) {
        setTransactions([]);
        return;
      }
      const url = new URL("/api/payments/history", window.location.origin);
      url.searchParams.set("lang", language);
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTransactions([]);
        return;
      }
      setTransactions(
        Array.isArray(data.transactions) ? data.transactions : [],
      );
    } finally {
      setHistoryLoading(false);
    }
  }, [getToken, language]);

  useEffect(() => {
    void loadMethods();
    void loadHistory();
  }, [loadMethods, loadHistory]);

  const startAddCard = async () => {
    setAddCardPreparing(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setError(isEn ? "Please sign in" : "Logg inn for å legge til kort");
        return;
      }
      setAccessToken(token);
      const res = await fetch("/api/payments/methods/setup-intent", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          String(
            data?.error || (isEn ? "Could not start" : "Kunne ikke starte"),
          ),
        );
        return;
      }
      const secret = String(data.client_secret || "").trim();
      const intentId = String(data.setup_intent_id || "").trim();
      if (!secret || !intentId) {
        setError(isEn ? "Invalid setup response" : "Ugyldig oppsett");
        return;
      }
      setAddCardSecret(secret);
      setAddCardIntentId(intentId);
      setShowAddCard(true);
    } finally {
      setAddCardPreparing(false);
    }
  };

  const handleAddCardSuccess = async () => {
    setShowAddCard(false);
    setAddCardSecret(null);
    setAddCardIntentId(null);
    await loadMethods();
  };

  const setDefaultMethod = async (id: string) => {
    setBusyId(id);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`/api/payments/methods/${id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ is_default: true }),
      });
      if (res.ok) await loadMethods();
    } finally {
      setBusyId(null);
    }
  };

  const removeMethod = async (id: string) => {
    setBusyId(id);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`/api/payments/methods/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) await loadMethods();
    } finally {
      setBusyId(null);
    }
  };

  if (selectedTransactionId) {
    return (
      <TransactionDetailPage
        transactionId={selectedTransactionId}
        onBack={() => setSelectedTransactionId(null)}
        language={language}
      />
    );
  }

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
          {isEn ? "Payment" : "Betaling"}
        </h1>
        <div className="w-10" />
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-6">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          {isEn ? "Payment methods" : "Betalingsmetoder"}
        </p>

        {!stripeConfigured && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            {isEn
              ? "Stripe is not configured on the server. Card management is disabled."
              : "Stripe er ikke konfigurert på serveren. Kortadministrasjon er deaktivert."}
          </div>
        )}

        {loading ? (
          <div className="space-y-2 mb-6">
            <PaymentMethodCardSkeleton />
            <PaymentMethodCardSkeleton />
          </div>
        ) : error ? (
          <div className="text-sm text-red-600 text-center py-6">{error}</div>
        ) : (
          <div className="space-y-2 mb-6">
            {methods.length === 0 && (
              <p className="text-sm text-muted-foreground py-2">
                {isEn ? "No saved cards yet." : "Ingen lagrede kort ennå."}
              </p>
            )}
            {methods.map((method) => (
              <div
                key={method.id}
                className="bg-card border border-border rounded-xl p-4"
              >
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 bg-muted rounded-lg flex items-center justify-center">
                    <CreditCard className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {method.label}
                    </p>
                    {method.is_default && (
                      <p className="text-xs text-green-600 font-medium">
                        {isEn ? "Default" : "Standard"}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {!method.is_default && (
                      <button
                        onClick={() => void setDefaultMethod(method.id)}
                        disabled={busyId === method.id}
                        className="w-8 h-8 bg-muted rounded-lg flex items-center justify-center hover:bg-muted/80 transition-colors disabled:opacity-50"
                        aria-label={
                          isEn ? "Set as default" : "Sett som standard"
                        }
                      >
                        <Check className="h-4 w-4 text-muted-foreground" />
                      </button>
                    )}
                    <button
                      onClick={() => void removeMethod(method.id)}
                      disabled={busyId === method.id}
                      className="w-8 h-8 bg-muted rounded-lg flex items-center justify-center hover:bg-red-50 transition-colors disabled:opacity-50"
                      aria-label={isEn ? "Remove card" : "Fjern kort"}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {stripeConfigured && !showAddCard && (
          <button
            onClick={() => void startAddCard()}
            disabled={addCardPreparing}
            className="w-full flex items-center justify-center gap-2 bg-card border border-border p-4 rounded-xl hover:bg-muted/50 transition-colors disabled:opacity-60"
          >
            {addCardPreparing ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <Plus className="h-5 w-5 text-muted-foreground" />
            )}
            <span className="text-sm font-medium text-foreground">
              {isEn ? "Add card" : "Legg til kort"}
            </span>
          </button>
        )}

        {showAddCard && addCardSecret && addCardIntentId && accessToken && (
          <div className="bg-card border border-border rounded-xl p-4 mt-2">
            <AddCardForm
              clientSecret={addCardSecret}
              setupIntentId={addCardIntentId}
              accessToken={accessToken}
              language={language}
              onSuccess={() => void handleAddCardSuccess()}
              onCancel={() => {
                setShowAddCard(false);
                setAddCardSecret(null);
                setAddCardIntentId(null);
              }}
            />
          </div>
        )}

        <div className="mt-8">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="w-full bg-card border border-border rounded-xl p-4 text-left"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center">
                  <Receipt className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {isEn ? "Transaction history" : "Transaksjonshistorikk"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {isEn
                      ? "Bookings and charges"
                      : "Bestillinger og belastninger"}
                  </p>
                </div>
              </div>
              <ChevronLeft
                className={`h-5 w-5 text-muted-foreground transition-transform ${
                  showHistory ? "-rotate-90" : "rotate-180"
                }`}
              />
            </div>
          </button>

          {showHistory && (
            <div className="mt-3 space-y-2">
              {historyLoading ? (
                <div className="space-y-2">
                  <TransactionRowSkeleton />
                  <TransactionRowSkeleton />
                  <TransactionRowSkeleton />
                </div>
              ) : transactions.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  {isEn ? "No payments yet" : "Ingen betalinger ennå"}
                </p>
              ) : (
                transactions.map((tx) => (
                  <button
                    key={tx.id}
                    type="button"
                    onClick={() => setSelectedTransactionId(tx.id)}
                    className="w-full bg-card border border-border rounded-xl p-4 text-left hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground truncate">
                          {displayServiceLabel(tx.service_name)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {tx.ui_date} · {tx.ui_time}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1.5">
                          {isEn ? "Delivery fee" : "Delivery-tillegg"}:{" "}
                          {formatAmount(tx.delivery_fee, tx.currency, language)}
                        </p>
                      </div>
                      <div className="flex items-start gap-2 shrink-0">
                        <div className="text-right">
                          <p className="text-sm font-bold text-foreground">
                            {formatAmount(
                              tx.total || tx.amount,
                              tx.currency,
                              language,
                            )}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {tx.status}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground mt-1" />
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
