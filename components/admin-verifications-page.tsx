"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, Loader2, ShieldCheck } from "lucide-react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { loginToContinueCopy } from "@/lib/auth/login-required-copy";
import { Button } from "@/components/ui/button";

type PendingProvider = {
  id: string;
  business_name?: string | null;
  phone?: string | null;
  stripe_payouts_enabled?: boolean | null;
  stripe_charges_enabled?: boolean | null;
  stripe_onboarded?: boolean | null;
  admin_approved?: boolean | null;
  created_at?: string | null;
};

interface AdminVerificationsPageProps {
  onBack: () => void;
  language?: "no" | "en";
}

export default function AdminVerificationsPage({
  onBack,
  language = "no",
}: AdminVerificationsPageProps) {
  const isEn = language === "en";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<PendingProvider[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [readyOnly, setReadyOnly] = useState(true);

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
        setError(loginToContinueCopy(isEn));
        setProviders([]);
        return;
      }
      const url = new URL(
        "/api/admin/providers/verifications",
        window.location.origin,
      );
      if (readyOnly) url.searchParams.set("ready", "1");
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          String(
            data?.error ||
              (isEn ? "Could not load pending providers" : "Kunne ikke hente listen"),
          ),
        );
        setProviders([]);
        return;
      }
      setProviders(Array.isArray(data.providers) ? data.providers : []);
    } catch {
      setError(isEn ? "Could not load pending providers" : "Kunne ikke hente listen");
      setProviders([]);
    } finally {
      setLoading(false);
    }
  }, [getToken, isEn, readyOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (providerId: string, action: "approve" | "reject") => {
    setBusyId(providerId);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch("/api/admin/providers/verifications", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ provider_id: providerId, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(String(data?.error || "Action failed"));
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  };

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
          {isEn ? "Provider approvals" : "Godkjenn tilbydere"}
        </h1>
        <div className="w-10" />
      </div>

      <div className="px-4 pt-4 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {isEn
            ? "First-cohort review on top of Stripe Connect."
            : "Første cohort — manuell godkjenning etter Stripe Connect."}
        </p>
        <button
          type="button"
          onClick={() => setReadyOnly((v) => !v)}
          className="text-xs font-medium text-foreground underline shrink-0"
        >
          {readyOnly
            ? isEn
              ? "Show all pending"
              : "Vis alle ventende"
            : isEn
              ? "Stripe-ready only"
              : "Kun Stripe-klar"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 pb-8">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="text-sm text-red-600 text-center py-8">{error}</p>
        ) : providers.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[40vh] text-center">
            <ShieldCheck className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-sm font-medium text-foreground">
              {isEn ? "No pending providers" : "Ingen ventende tilbydere"}
            </p>
          </div>
        ) : (
          providers.map((p) => {
            const name = String(p.business_name || "").trim() || "—";
            const stripeReady = Boolean(p.stripe_payouts_enabled);
            return (
              <div
                key={p.id}
                className="rounded-xl border border-border bg-card p-4 space-y-3"
              >
                <div>
                  <p className="font-semibold text-foreground">{name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {p.phone || p.id.slice(0, 8)}
                  </p>
                  <p className="text-xs mt-1">
                    <span
                      className={
                        stripeReady ? "text-green-600" : "text-amber-600"
                      }
                    >
                      {stripeReady
                        ? isEn
                          ? "Stripe payouts ready"
                          : "Stripe-utbetaling klar"
                        : isEn
                          ? "Stripe setup incomplete"
                          : "Stripe ikke ferdig"}
                    </span>
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    className="flex-1 h-10 rounded-xl"
                    disabled={busyId === p.id || !stripeReady}
                    onClick={() => void act(p.id, "approve")}
                  >
                    {busyId === p.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : isEn ? (
                      "Approve"
                    ) : (
                      "Godkjenn"
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 h-10 rounded-xl"
                    disabled={busyId === p.id}
                    onClick={() => void act(p.id, "reject")}
                  >
                    {isEn ? "Reject" : "Avvis"}
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </main>
  );
}
