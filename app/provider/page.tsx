"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import {
  MapPin,
  Check,
  X,
  Wifi,
  WifiOff,
  Scissors,
  LogOut,
  Satellite,
  Phone,
} from "lucide-react";
import { sendPhoneOtpRequest, verifyPhoneSms } from "@/lib/auth/phone-client";
import type { User } from "@supabase/supabase-js";
import { haversineKm } from "@/lib/geo";
import { offerCountdownSeconds } from "@/lib/orders/offerCountdown";
import { ReadyForNextLockedButton } from "@/components/ready-for-next-locked-button";
import { formatDbOrderStatusLabel } from "@/lib/orders/order-status-ui";

type Offer = {
  offer_id: string;
  order_id: string;
  style_name: string;
  distance_km: number;
  eta_minutes: number;
  payout: number;
  expires_at: string | null;
};

function useGeoWatch() {
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const idRef = useRef<number | null>(null);

  const start = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setErr("Geolokasjon ikke støttet");
      return;
    }
    if (idRef.current != null) return;
    idRef.current = navigator.geolocation.watchPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
        setErr(null);
      },
      (e) => setErr(e.message || "Kunne ikke lese posisjon"),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 },
    );
  }, []);
  const stop = useCallback(() => {
    if (idRef.current != null) {
      navigator.geolocation.clearWatch(idRef.current);
      idRef.current = null;
    }
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { pos, err, start, stop };
}

export default function ProviderPage() {
  const supabase = useMemo(() => createBrowserSupabaseClient() as any, []);
  const hasSupabase = useMemo(
    () => !!(supabase && typeof supabase.from === "function" && supabase.auth),
    [supabase],
  );

  const [user, setUser] = useState<User | null>(null);
  const userIdRef = useRef<string | null>(null);
  userIdRef.current = user?.id ?? null;
  const [phoneLocal, setPhoneLocal] = useState("");
  const [showOtp, setShowOtp] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [authErr, setAuthErr] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [homeService, setHomeService] = useState(true);
  const [capacity, setCapacity] = useState(1);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [activeJob, setActiveJob] = useState<{
    id: string;
    status: string;
    started_at: string | null;
    ready_for_next_request_at: string | null;
    duration_minutes: number;
  } | null>(null);
  const [activeJobBusy, setActiveJobBusy] = useState(false);
  const offersChannelRef = useRef<any | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const {
    pos: livePos,
    err: geoErr,
    start: startGeo,
    stop: stopGeo,
  } = useGeoWatch();

  useEffect(() => {
    if (!hasSupabase) return;
    let unsub: any;
    supabase.auth
      .getSession()
      .then(({ data }: any) => setUser(data?.session?.user ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_e: any, session: any) => {
        setUser(session?.user ?? null);
      },
    );
    unsub = listener?.subscription;
    return () => unsub?.unsubscribe?.();
  }, [hasSupabase, supabase]);

  const phoneE164 = useMemo(() => {
    const d = phoneLocal.replace(/\D/g, "").slice(0, 8);
    if (d.length < 8) return null;
    return `+47${d}`;
  }, [phoneLocal]);

  const sendPhoneCode = async () => {
    setAuthErr(null);
    if (!hasSupabase || !phoneE164) return;
    setSending(true);
    try {
      const { error } = await sendPhoneOtpRequest(phoneE164, "provider");
      if (error) {
        setAuthErr(error);
        return;
      }
      setOtpCode("");
      setShowOtp(true);
    } finally {
      setSending(false);
    }
  };

  const verifyPhoneCode = async () => {
    setAuthErr(null);
    if (!hasSupabase || !phoneE164) return;
    const token = otpCode.replace(/\D/g, "");
    if (token.length < 4) {
      setAuthErr("Skriv inn koden fra SMS.");
      return;
    }
    setVerifying(true);
    try {
      const { error } = await verifyPhoneSms(supabase, phoneE164, token);
      if (error) {
        setAuthErr(error.message);
        return;
      }
      setShowOtp(false);
    } finally {
      setVerifying(false);
    }
  };
  const signOut = async () => {
    if (!hasSupabase) return;
    await supabase.auth.signOut({ scope: "global" });
    setUser(null);
    setShowOtp(false);
    setOtpCode("");
    setAuthErr(null);
  };

  // Ensure provider profile exists and load settings
  useEffect(() => {
    const run = async () => {
      if (!hasSupabase || !user) return;
      // Upsert profile with provider role if not set yet
      await supabase.from("profiles").upsert(
        {
          id: user.id,
          role: "provider",
          name: user.user_metadata?.name || "Provider",
        },
        { onConflict: "id" },
      );
      // Upsert provider_details if missing
      const { data: pp } = await supabase
        .from("provider_details")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();
      if (pp) {
        setOnline(!!pp.is_online);
        setHomeService(
          Array.isArray(pp.delivery_modes)
            ? pp.delivery_modes.includes("home")
            : true,
        );
      }
    };
    run();
  }, [hasSupabase, user, supabase]);

  // Online toggle -> gated API (Stripe payouts + admin approve + skills).
  const toggleOnline = async () => {
    if (!hasSupabase || !user) return;
    const newVal = !online;
    setOnline(newVal);
    try {
      const res = await fetch("/api/providers/online", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-provider-id": user.id,
        },
        body: JSON.stringify({ is_online: newVal }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        is_online?: boolean;
      };
      const live = res.ok && json.is_online === true;
      setOnline(live);
      if (live) startGeo();
      else stopGeo();
    } catch {
      setOnline(false);
      stopGeo();
    }
  };

  // Persist live location
  useEffect(() => {
    const upsert = async () => {
      if (!hasSupabase || !user || !livePos) return;
      await supabase.from("realtime_locations").upsert({
        provider_id: user.id,
        lat: livePos.lat,
        lng: livePos.lng,
        updated_at: new Date().toISOString(),
      });
      // Mirror live point into provider_details coordinates.
      await supabase
        .from("provider_details")
        .update({ lat: livePos.lat, lng: livePos.lng })
        .eq("id", user.id);
    };
    upsert();
  }, [hasSupabase, user, livePos, supabase]);

  // Save settings
  useEffect(() => {
    const save = async () => {
      if (!hasSupabase || !user) return;
      await supabase
        .from("provider_details")
        .update({
          delivery_modes: homeService
            ? ["home", "at_provider"]
            : ["at_provider"],
        })
        .eq("id", user.id);
    };
    // Debounce lightly
    const t = setTimeout(save, 300);
    return () => clearTimeout(t);
  }, [homeService, capacity, hasSupabase, user, supabase]);

  const upsertOfferFromRow = useCallback(
    async (row: any) => {
      const uid = userIdRef.current;
      if (!hasSupabase || !uid || !row) return;
      if (String(row.status || "") !== "pending") return;
      if (
        row.expires_at &&
        Date.now() > new Date(String(row.expires_at)).getTime()
      ) {
        return;
      }
      const { data: order } = await supabase
        .from("orders")
        .select("*")
        .eq("id", row.order_id)
        .single();
      if (!order) return;
      const { data: pp } = await supabase
        .from("provider_details")
        .select("lat,lng")
        .eq("id", uid)
        .single();
      const from = { lat: pp?.lat ?? 59.9139, lng: pp?.lng ?? 10.7522 };
      const to =
        String(order.delivery_mode) === "home"
          ? { lat: order.customer_lat, lng: order.customer_lng }
          : from;
      const dist = haversineKm(from, to);
      const { data: priceLock } = await supabase
        .from("booking_price_locks")
        .select("provider_total")
        .eq("order_id", row.order_id)
        .maybeSingle();
      const lockPayout = Math.round(Number(priceLock?.provider_total) || 0);
      const payout =
        lockPayout > 0
          ? lockPayout
          : Math.round(Number(order.price ?? 0) * 0.7);
      const eta = Math.max(1, Math.round((dist / 28) * 60));
      setOffers((prev) => {
        const idx = prev.findIndex((o) => o.order_id === row.order_id);
        return [
          {
            offer_id: row.id,
            order_id: row.order_id,
            style_name: String(order.service_id ?? "Service"),
            distance_km: dist,
            eta_minutes: eta,
            payout,
            expires_at: row.expires_at ? String(row.expires_at) : null,
          },
          ...prev.filter((_, i) => i !== idx),
        ];
      });
    },
    [hasSupabase, supabase],
  );

  const refreshActiveJob = useCallback(async () => {
    if (!hasSupabase || !user) return;
    const { data } = await supabase
      .from("orders")
      .select("id, status, started_at, ready_for_next_request_at, service_id")
      .eq("provider_id", user.id)
      .in("status", ["assigned", "en_route", "arrived", "in_progress"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let durationMinutes = 30;
    const serviceId = data?.service_id ? String(data.service_id) : "";
    if (serviceId) {
      const { data: service } = await supabase
        .from("services")
        .select("duration_minutes")
        .eq("id", serviceId)
        .maybeSingle();
      const d = Number(
        (service as { duration_minutes?: number } | null)?.duration_minutes,
      );
      if (Number.isFinite(d) && d > 0) durationMinutes = d;
    }

    setActiveJob(
      data && typeof data.id === "string"
        ? {
            id: data.id,
            status: String(data.status || ""),
            started_at: data.started_at ? String(data.started_at) : null,
            ready_for_next_request_at: data.ready_for_next_request_at
              ? String(data.ready_for_next_request_at)
              : null,
            duration_minutes: durationMinutes,
          }
        : null,
    );
  }, [hasSupabase, user, supabase]);

  useEffect(() => {
    if (!hasSupabase || !user) {
      setActiveJob(null);
      return;
    }
    void refreshActiveJob();
    const id = setInterval(() => void refreshActiveJob(), 4000);
    return () => clearInterval(id);
  }, [hasSupabase, user, refreshActiveJob]);

  const loadPendingOffers = useCallback(async () => {
    const uid = userIdRef.current;
    if (!hasSupabase || !uid) return;
    const { data } = await supabase
      .from("order_offers")
      .select("id, order_id, expires_at, status")
      .eq("provider_id", uid)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("expires_at", { ascending: true });
    const rows = Array.isArray(data) ? data : [];
    for (const row of rows) {
      await upsertOfferFromRow(row);
    }
  }, [hasSupabase, supabase, upsertOfferFromRow]);

  // Subscribe to incoming offers (Realtime only; one catch-up fetch on SUBSCRIBED).
  useEffect(() => {
    const uid = userIdRef.current;
    if (!hasSupabase || !uid) return;

    offersChannelRef.current?.unsubscribe?.();
    const ch = supabase
      .channel(`offers-${uid}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_offers",
          filter: `provider_id=eq.${uid}`,
        },
        async (payload: any) => {
          const row = payload?.new;
          if (!row) return;
          if (String(row.status || "") !== "pending") {
            setOffers((prev) => prev.filter((o) => o.offer_id !== row.id));
            return;
          }
          await upsertOfferFromRow(row);
        },
      )
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") {
          void loadPendingOffers();
        }
      });
    offersChannelRef.current = ch;
    return () => {
      ch.unsubscribe();
    };
  }, [hasSupabase, user?.id, supabase, loadPendingOffers, upsertOfferFromRow]);

  // Keep UI in sync with offer expiry (dispatch sub-wave TTL). Also enables countdown rendering.
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      setOffers((prev) =>
        prev.filter((o) => {
          if (!o.expires_at) return true;
          return now <= new Date(o.expires_at).getTime();
        }),
      );
    }, 500);
    return () => clearInterval(t);
  }, []);

  const accept = async (offer_id: string) => {
    if (!hasSupabase || !user) return;
    try {
      const res = await fetch("/api/orders/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offer_id, provider_id: user.id }),
      });
      const data = await res.json();
      if (data.success) {
        setOffers((prev) => prev.filter((o) => o.offer_id !== offer_id));
        await refreshActiveJob();
      } else {
        setAuthErr(data.error ?? "Could not accept order — please try again");
      }
    } catch (e) {
      setAuthErr(e instanceof Error ? e.message : "Network error");
    }
  };

  const decline = (order_id: string) => {
    setOffers((prev) => prev.filter((o) => o.order_id !== order_id));
  };

  const startActiveService = async () => {
    if (!hasSupabase || !user || !activeJob) return;
    setActiveJobBusy(true);
    setAuthErr(null);
    try {
      const res = await fetch("/api/orders/start_service", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: activeJob.id,
          provider_id: user.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok !== true) {
        setAuthErr(
          data?.error ||
            "Kunne ikke starte tjeneste (sjekk at migrasjon er kjort).",
        );
        return;
      }
      await refreshActiveJob();
    } catch (e) {
      setAuthErr(e instanceof Error ? e.message : "Nettverksfeil");
    } finally {
      setActiveJobBusy(false);
    }
  };

  const transitionActiveJob = async (
    next: "en_route" | "arrived" | "in_progress",
  ) => {
    if (!hasSupabase || !user || !activeJob) return;
    setActiveJobBusy(true);
    setAuthErr(null);
    try {
      const res = await fetch("/api/orders/transition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: activeJob.id,
          provider_id: user.id,
          next_status: next,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok !== true) {
        setAuthErr(String(data?.error || "Kunne ikke oppdatere ordrestatus."));
        return;
      }
      await refreshActiveJob();
    } catch (e) {
      setAuthErr(e instanceof Error ? e.message : "Nettverksfeil");
    } finally {
      setActiveJobBusy(false);
    }
  };

  const markReadyForNext = async () => {
    if (!hasSupabase || !user || !activeJob) return;
    setActiveJobBusy(true);
    setAuthErr(null);
    try {
      const res = await fetch("/api/orders/ready_for_next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: activeJob.id,
          provider_id: user.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok !== true) {
        setAuthErr(
          data?.error ||
            "Kunne ikke oppdatere (jobben ma vare in_progress — start tjeneste først).",
        );
        return;
      }
      await refreshActiveJob();
    } catch (e) {
      setAuthErr(e instanceof Error ? e.message : "Nettverksfeil");
    } finally {
      setActiveJobBusy(false);
    }
  };

  return (
    <main className="mx-auto h-[100dvh] w-full max-w-md bg-background p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold flex items-center gap-2">
            <Scissors className="h-5 w-5" />
            Fresh Up • Provider
          </h1>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Full jobb-UI: bruk{" "}
            <a href="/" className="underline">
              hovedappen
            </a>{" "}
            (provider-modus)
          </p>
        </div>
        <div className="flex items-center gap-2">
          {online ? (
            <Badge className="gap-1">
              <Wifi className="h-3 w-3" /> Online
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1">
              <WifiOff className="h-3 w-3" /> Offline
            </Badge>
          )}
          {hasSupabase && user && (
            <Button variant="outline" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4 mr-1" /> Logg ut
            </Button>
          )}
        </div>
      </div>

      {!hasSupabase && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Supabase ikke konfigurert</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Sett NEXT_PUBLIC_SUPABASE_URL og NEXT_PUBLIC_SUPABASE_ANON_KEY for å
            aktivere ekte provider-flyt.
          </CardContent>
        </Card>
      )}

      {hasSupabase && !user && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Phone className="h-4 w-4" />
              {showOtp ? "Skriv inn kode" : "Logg inn med telefon"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!showOtp ? (
              <>
                <div className="flex gap-2">
                  <span className="flex items-center px-2 text-sm text-muted-foreground border rounded-md">
                    +47
                  </span>
                  <Input
                    placeholder="12 34 56 78"
                    value={phoneLocal}
                    onChange={(e) =>
                      setPhoneLocal(
                        e.target.value.replace(/\D/g, "").slice(0, 8),
                      )
                    }
                    inputMode="numeric"
                  />
                </div>
                {authErr && (
                  <p className="text-sm text-destructive">{authErr}</p>
                )}
                <Button
                  className="w-full"
                  onClick={() => void sendPhoneCode()}
                  disabled={!phoneE164 || sending}
                >
                  {sending ? "Sender…" : "Send kode"}
                </Button>
              </>
            ) : (
              <>
                <Input
                  placeholder="Kode fra SMS"
                  value={otpCode}
                  onChange={(e) =>
                    setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 8))
                  }
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="text-center tracking-widest"
                />
                {authErr && (
                  <p className="text-sm text-destructive">{authErr}</p>
                )}
                <Button
                  className="w-full"
                  onClick={() => void verifyPhoneCode()}
                  disabled={otpCode.replace(/\D/g, "").length < 4 || verifying}
                >
                  {verifying ? "Bekrefter…" : "Logg inn"}
                </Button>
                <Button
                  variant="ghost"
                  className="w-full text-xs"
                  onClick={() => void sendPhoneCode()}
                  disabled={sending}
                >
                  Send på nytt
                </Button>
                <Button
                  variant="ghost"
                  className="w-full text-xs"
                  onClick={() => {
                    setShowOtp(false);
                    setAuthErr(null);
                    setOtpCode("");
                  }}
                >
                  Endre nummer
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {hasSupabase && user && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Tilgjengelighet</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Home service
                </span>
                <Button
                  variant={homeService ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setHomeService((v) => !v)}
                >
                  {homeService ? "På" : "Av"}
                </Button>
              </div>
              <div>
                <Label className="text-sm">Kapasitet (stoler)</Label>
                <Input
                  type="number"
                  value={capacity}
                  onChange={(e) => setCapacity(Number(e.target.value) || 1)}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Satellite className="h-4 w-4" />
                  Live-posisjon:{" "}
                  {livePos
                    ? `${livePos.lat.toFixed(4)}, ${livePos.lng.toFixed(4)}`
                    : "—"}
                </div>
                <Button size="sm" onClick={toggleOnline}>
                  {online ? "Gå offline" : "Gå online"}
                </Button>
              </div>
              {geoErr && (
                <div className="text-xs text-destructive">{geoErr}</div>
              )}
            </CardContent>
          </Card>

          {activeJob && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Aktiv jobb</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="text-muted-foreground">
                  Ordre{" "}
                  <span className="font-mono text-xs">{activeJob.id}</span>
                  {" · "}
                  {formatDbOrderStatusLabel(activeJob.status, "no")}
                </div>
                {activeJob.status === "assigned" && (
                  <Button
                    className="w-full"
                    size="sm"
                    disabled={activeJobBusy}
                    onClick={() => void transitionActiveJob("en_route")}
                  >
                    Start kjøring
                  </Button>
                )}
                {activeJob.status === "en_route" && (
                  <Button
                    className="w-full"
                    size="sm"
                    disabled={activeJobBusy}
                    onClick={() => void transitionActiveJob("arrived")}
                  >
                    Markert fremme
                  </Button>
                )}
                {activeJob.status === "arrived" && (
                  <Button
                    className="w-full"
                    size="sm"
                    disabled={activeJobBusy}
                    onClick={() => void startActiveService()}
                  >
                    Start tjeneste
                  </Button>
                )}
                {activeJob.status === "in_progress" &&
                  !activeJob.ready_for_next_request_at && (
                    <ReadyForNextLockedButton
                      serviceStartedAtIso={activeJob.started_at}
                      typicalDurationMinutes={activeJob.duration_minutes}
                      nowMs={nowMs}
                      size="sm"
                      label="Klar for neste forespørsel"
                      hint="Halvveis i tjenesten kan du melde deg klar for neste jobb mens du fullfører denne."
                      unlocksInLabel="Tilgjengelig om"
                      onActivate={() => void markReadyForNext()}
                    />
                  )}
                {activeJob.status === "in_progress" &&
                  activeJob.ready_for_next_request_at && (
                    <Badge
                      variant="secondary"
                      className="w-full justify-center"
                    >
                      I dispatch-køen (nye jobber kan komme)
                    </Badge>
                  )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Innkommende jobber</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {offers.length === 0 && (
                <div className="text-sm text-muted-foreground">
                  Ingen tilbud akkurat nå
                </div>
              )}
              {offers.map((o) => (
                <div key={o.order_id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-sm">{o.style_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {o.payout} kr
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                    <MapPin className="h-3 w-3" />
                    {o.distance_km.toFixed(1)} km • {o.eta_minutes} min
                    {o.expires_at && (
                      <> • {offerCountdownSeconds(o.expires_at, nowMs)}s</>
                    )}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Button
                      className="flex-1 gap-1"
                      size="sm"
                      onClick={() => accept(o.offer_id)}
                    >
                      <Check className="h-4 w-4" />
                      Godta
                    </Button>
                    <Button
                      className="flex-1 gap-1 bg-transparent"
                      size="sm"
                      variant="outline"
                      onClick={() => decline(o.order_id)}
                    >
                      <X className="h-4 w-4" />
                      Avslå
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}
