import type { SupabaseClient } from "@supabase/supabase-js";
import { matchProvidersWithRpcError } from "@/lib/orders/dispatchOrder";
import { MAX_DISPATCH_MATCH_RADIUS_KM } from "@/lib/orders/dispatch-radius";
import { releaseOrderPayment } from "@/lib/payments/order-payment";
import {
  DISPATCH_BATCH_OPEN_MS,
  DISPATCH_MATCHES_PER_WAVE,
  DISPATCH_PROVIDER_OFFER_TTL_MS,
  DISPATCH_TIER_GAP_MS,
  DISPATCH_TIERS_PER_BATCH,
  dispatchStepDelayMs,
} from "@/lib/orders/dispatchTiming";
  
type Batch = {
  min_distance_km: number;
  max_distance_km: number;
  min_rating: number;
  name: string;
};

/** Architecture §4.2 — skill + distance batches (6 waves). */
const BATCHES: Batch[] = [
  {
    min_distance_km: 0,
    max_distance_km: 3,
    min_rating: 4.5,
    name: "Batch 1: 5★ within 0–3km",
  },
  {
    min_distance_km: 0,
    max_distance_km: 3,
    min_rating: 3.5,
    name: "Batch 2: 4★ within 0–3km",
  },
  {
    min_distance_km: 3,
    max_distance_km: 6,
    min_rating: 4.5,
    name: "Batch 3: 5★ within 3–6km",
  },
  {
    min_distance_km: 3,
    max_distance_km: 6,
    min_rating: 3.5,
    name: "Batch 4: 4★ within 3–6km",
  },
  {
    min_distance_km: 6,
    max_distance_km: MAX_DISPATCH_MATCH_RADIUS_KM,
    min_rating: 4.5,
    name: "Batch 5: 5★ within 6–10km",
  },
  {
    min_distance_km: 6,
    max_distance_km: MAX_DISPATCH_MATCH_RADIUS_KM,
    min_rating: 3.5,
    name: "Batch 6: 4★ within 6–10km",
  },
];

/**
 * Per batch: Gold → Silver → Bronze at 0s / 3s / 6s, then next batch at +10s.
 * Example Batch 1 (0–3 km, 5★): Gold t=0, Silver t=3, Bronze t=6.
 */
const PERF_TIERS = ["gold", "silver", "bronze"] as const;

const TOTAL_STEPS = BATCHES.length * DISPATCH_TIERS_PER_BATCH;
const LAST_STEP_DELAY_MS =
  (BATCHES.length - 1) * DISPATCH_BATCH_OPEN_MS +
  (DISPATCH_TIERS_PER_BATCH - 1) * DISPATCH_TIER_GAP_MS;

function waveIndices(stepIndex: number) {
  return {
    batchIndex: Math.floor(stepIndex / DISPATCH_TIERS_PER_BATCH),
    tierIndex: stepIndex % DISPATCH_TIERS_PER_BATCH,
  };
}

function waveMeta(stepIndex: number) {
  const { batchIndex, tierIndex } = waveIndices(stepIndex);
  const batch = BATCHES[batchIndex];
  const tier = PERF_TIERS[tierIndex];
  if (!batch || !tier) return null;
  return {
    wave_index: stepIndex,
    batch: batch.name,
    performance_tier: tier,
    wave_name: `${batch.name} · ${tier}`,
  };
}

/** Mirrors dispatch_wave_index for Supabase dashboards (0-based batch, 1-based tier slot). */
export function batchColumnsFromWaveStep(stepIndex: number): {
  current_batch_index: number;
  current_batch_iteration: number;
} {
  const { batchIndex, tierIndex } = waveIndices(
    Math.max(0, Math.min(stepIndex, TOTAL_STEPS - 1)),
  );
  return {
    current_batch_index: batchIndex,
    current_batch_iteration: tierIndex + 1,
  };
}

function iso() {
  return new Date().toISOString();
}

export type DispatchTickOptions = {
  limit?: number;
  onlyOrderId?: string;
  /** On book confirm: run exactly this wave now (typically 0 = Batch 1 · Gold). */
  immediateThroughStep?: number;
};

export async function dispatchTick(
  supabase: SupabaseClient,
  opts?: DispatchTickOptions,
) {
  const limit = Math.max(1, Math.min(Number(opts?.limit ?? 25) || 25, 100));
  const lockStaleBefore = new Date(Date.now() - 30_000).toISOString();
  const now = iso();

  const { data: candidates, error: candErr } = opts?.onlyOrderId
    ? await supabase
        .from("orders")
        .select("*")
        .eq("id", opts.onlyOrderId)
        .limit(1)
    : await supabase
        .from("orders")
        .select("*")
        .is("provider_id", null)
        .in("status", ["pending", "offered"])
        .or(
          `dispatch_lock_token.is.null,dispatch_locked_at.lt.${lockStaleBefore}`,
        )
        .or(`dispatch_deadline_at.is.null,dispatch_deadline_at.gt.${now}`)
        .order("dispatch_wave_started_at", {
          ascending: true,
          nullsFirst: true,
        } as any)
        .order("created_at", { ascending: true })
        .limit(limit);
  if (candErr) throw candErr;

  const results: any[] = [];

  for (const order of candidates ?? []) {
    const orderId = String((order as any)?.id || "");
    if (!orderId) continue;
    const status = String((order as any)?.status || "");
    if (!["pending", "offered"].includes(status)) {
      results.push({ order_id: orderId, action: "skipped_not_dispatchable" });
      continue;
    }

    const lockToken = crypto.randomUUID();
    const lockNow = iso();
    const { data: lockedRows, error: lockErr } = await supabase
      .from("orders")
      .update({ dispatch_lock_token: lockToken, dispatch_locked_at: lockNow })
      .eq("id", orderId)
      .is("provider_id", null)
      .in("status", ["pending", "offered"])
      .or(
        `dispatch_lock_token.is.null,dispatch_locked_at.lt.${lockStaleBefore}`,
      )
      .select("id")
      .limit(1);
    if (lockErr) throw lockErr;
    if (!lockedRows?.length) {
      results.push({ order_id: orderId, action: "skipped_locked" });
      continue;
    }

    try {
      const startedAtIso =
        (order as any)?.dispatch_started_at ??
        (order as any)?.created_at ??
        lockNow;
      const startedAtMs = new Date(String(startedAtIso)).getTime();
      const strictDeadlineMs =
        startedAtMs + LAST_STEP_DELAY_MS + DISPATCH_PROVIDER_OFFER_TTL_MS;
      const existingDeadlineMs = new Date(
        String((order as any)?.dispatch_deadline_at ?? ""),
      ).getTime();
      const deadlineAtIso = new Date(
        Number.isFinite(existingDeadlineMs)
          ? Math.min(existingDeadlineMs, strictDeadlineMs)
          : strictDeadlineMs,
      ).toISOString();

      if (Date.now() > new Date(deadlineAtIso).getTime()) {
        await supabase
          .from("orders")
          .update({
            status: "cancelled",
            cancelled_at: lockNow,
            cancellation_reason:
              "No providers available right now. Please try again.",
          })
          .eq("id", orderId)
          .is("provider_id", null);
        await supabase
          .from("order_offers")
          .update({ status: "expired" })
          .eq("order_id", orderId)
          .eq("status", "pending");
        await releaseOrderPayment(supabase, orderId);
        results.push({ order_id: orderId, action: "cancelled_timeout" });
        continue;
      }

      await supabase
        .from("order_offers")
        .update({ status: "expired" })
        .eq("order_id", orderId)
        .eq("status", "pending")
        .lte("expires_at", lockNow);

      const elapsedMs = Date.now() - startedAtMs;
      let maxDueStep = (() => {
        let idx = -1;
        for (let i = 0; i < TOTAL_STEPS; i += 1) {
          if (elapsedMs >= dispatchStepDelayMs(i)) {
            idx = i;
          } else {
            break;
          }
        }
        return idx;
      })();

      if (opts?.immediateThroughStep != null) {
        const cap = Math.max(0, Math.min(opts.immediateThroughStep, TOTAL_STEPS - 1));
        maxDueStep = cap;
      }

      const prior = Number((order as any)?.dispatch_wave_index);
      let nextStep = Number.isFinite(prior) ? prior + 1 : 0;
      if (nextStep > maxDueStep) {
        results.push({
          order_id: orderId,
          action: "waiting_next_wave",
          next_wave: waveMeta(nextStep),
          latest_due_wave: maxDueStep >= 0 ? waveMeta(maxDueStep) : null,
        });
        continue;
      }
      if (nextStep >= TOTAL_STEPS) {
        await supabase
          .from("orders")
          .update({
            status: "cancelled",
            cancelled_at: lockNow,
            cancellation_reason:
              "No providers available right now. Please try again.",
            dispatch_started_at: startedAtIso,
            dispatch_deadline_at: deadlineAtIso,
            dispatch_wave_index: TOTAL_STEPS - 1,
            dispatch_wave_started_at: lockNow,
            ...batchColumnsFromWaveStep(TOTAL_STEPS - 1),
          })
          .eq("id", orderId)
          .is("provider_id", null);
        await releaseOrderPayment(supabase, orderId);
        results.push({ order_id: orderId, action: "cancelled_timeout" });
        continue;
      }

      const { data: service, error: serviceErr } = await supabase
        .from("services")
        .select("id, mode_id, target_id, category_id")
        .eq("id", (order as any)?.service_id)
        .single();
      if (serviceErr || !service) {
        results.push({ order_id: orderId, action: "skipped_not_dispatchable" });
        continue;
      }

      const { data: alreadyOffers, error: alreadyErr } = await supabase
        .from("order_offers")
        .select("provider_id, status")
        .eq("order_id", orderId);
      if (alreadyErr) throw alreadyErr;
      const providersWhoAlreadySawOffer = new Set<string>();
      const blockedProviders = new Set<string>();
      for (const r of alreadyOffers ?? []) {
        const pid = String((r as any)?.provider_id || "").trim();
        if (!pid) continue;
        const st = String((r as any)?.status || "").trim();
        providersWhoAlreadySawOffer.add(pid);
        if (st === "declined" || st === "accepted") {
          blockedProviders.add(pid);
        }
      }
      let totalOffersSent = 0;
      const waveOutcomes: Array<{
        wave_index: number;
        wave_name: string;
        performance_tier: string;
        batch: string;
        offers_sent: number;
      }> = [];

      // One tier wave per tick — never catch up Silver+Bronze in a single cron run.
      if (nextStep <= maxDueStep && nextStep < TOTAL_STEPS) {
        const stepToRun = nextStep;
        const { batchIndex, tierIndex } = waveIndices(stepToRun);
        const batch = BATCHES[batchIndex]!;
        const perfTier = PERF_TIERS[tierIndex]!;
        const waveName = `${batch.name} · ${perfTier}`;

        const { rows: matchesAll, error: matchRpcErr, rpcAppliesPerformanceTier } =
          await matchProvidersWithRpcError(supabase, {
            mode_id: String((service as any).mode_id),
            target_id: String((service as any).target_id),
            category_id: String((service as any).category_id),
            service_id: String((service as any).id),
            service_mode_id:
              String((order as any)?.delivery_mode) === "home"
                ? "home"
                : "provider",
            customer_lat: Number((order as any)?.customer_lat),
            customer_lng: Number((order as any)?.customer_lng),
            scheduled_at: (order as any)?.scheduled_at ?? null,
            max_distance_km: batch.max_distance_km,
            min_rating: batch.min_rating,
            performance_tier: perfTier,
            customer_id: (order as any)?.customer_id
              ? String((order as any).customer_id)
              : null,
          });
        if (matchRpcErr) {
          results.push({
            order_id: orderId,
            action: "match_rpc_error",
            wave_index: stepToRun,
            wave_name: waveName,
            performance_tier: perfTier,
            batch: batch.name,
            rpc_error: matchRpcErr,
          });
        } else {
          let tierFiltered = matchesAll ?? [];
          if (!rpcAppliesPerformanceTier && tierFiltered.length > 0) {
            const providerIds = tierFiltered.map((m) => String(m.provider_id));
            const { data: tierRows } = await supabase
              .from("provider_details")
              .select("id, dispatch_performance_tier")
              .in("id", providerIds);
            const tierByProvider = new Map<string, string>();
            for (const row of tierRows ?? []) {
              const id = String((row as { id?: string }).id || "");
              const tier = String(
                (row as { dispatch_performance_tier?: string })
                  .dispatch_performance_tier || "silver",
              )
                .trim()
                .toLowerCase();
              tierByProvider.set(id, tier || "silver");
            }
            tierFiltered = tierFiltered.filter(
              (m) =>
                (tierByProvider.get(String(m.provider_id)) || "silver") ===
                perfTier,
            );
          }

          const matches = tierFiltered
            .filter((m: any) => {
              const pid = String(m?.provider_id || "").trim();
              if (!pid) return false;
              const distanceKm = Number(m?.distance_km);
              if (!Number.isFinite(distanceKm)) return false;
              if (
                distanceKm < batch.min_distance_km ||
                distanceKm > batch.max_distance_km
              ) {
                return false;
              }
              if (blockedProviders.has(pid)) return false;
              if (providersWhoAlreadySawOffer.has(pid)) return false;
              return true;
            })
            .slice(0, DISPATCH_MATCHES_PER_WAVE);

          const offeredPrice = (order as any)?.price ?? null;
          const toInsert: Array<{
            order_id: string;
            provider_id: string;
            status: "pending";
            offered_price: any;
            provider_distance_km: number;
            expires_at: string;
          }> = [];

          for (const p of matches) {
            const pid = String((p as any)?.provider_id || "").trim();
            if (!pid) continue;
            toInsert.push({
              order_id: orderId,
              provider_id: pid,
              status: "pending",
              offered_price: offeredPrice,
              provider_distance_km: Number(
                Number((p as any)?.distance_km || 0).toFixed(3),
              ),
              expires_at: new Date(
                Date.now() + DISPATCH_PROVIDER_OFFER_TTL_MS,
              ).toISOString(),
            });
            providersWhoAlreadySawOffer.add(pid);
          }

          if (toInsert.length > 0) {
            const { error: insertErr } = await supabase
              .from("order_offers")
              .insert(toInsert);
            if (insertErr) throw insertErr;
            totalOffersSent += toInsert.length;

            void import("@/lib/notifications/expo-push").then(({ notifyUsers }) =>
              notifyUsers({
                userIds: toInsert.map((r) => r.provider_id),
                title: "New job offer",
                body: "A nearby customer needs help. Open Fresh Up to accept.",
                data: {
                  type: "new_offer",
                  order_id: orderId,
                },
              }),
            );
          }

          waveOutcomes.push({
            wave_index: stepToRun,
            wave_name: waveName,
            performance_tier: perfTier,
            batch: batch.name,
            offers_sent: toInsert.length,
          });
        }
      }

      const lastProcessedStep =
        waveOutcomes.length > 0
          ? waveOutcomes[waveOutcomes.length - 1]!.wave_index
          : Math.max(prior, -1);
      const batchCols =
        lastProcessedStep >= 0
          ? batchColumnsFromWaveStep(lastProcessedStep)
          : batchColumnsFromWaveStep(0);
      await supabase
        .from("orders")
        .update({
          dispatch_started_at: startedAtIso,
          dispatch_deadline_at: deadlineAtIso,
          dispatch_wave_index: lastProcessedStep,
          dispatch_wave_started_at: lockNow,
          ...batchCols,
          ...(totalOffersSent > 0 ? { last_batch_sent_at: lockNow } : {}),
          status:
            totalOffersSent > 0
              ? "offered"
              : status === "pending" || status === "offered"
                ? "offered"
                : status,
        })
        .eq("id", orderId)
        .is("provider_id", null)
        .in("status", ["pending", "offered"]);

      results.push({
        order_id: orderId,
        action:
          totalOffersSent > 0 ? "offers_sent" : "advanced_wave_no_matches",
        offers_sent: totalOffersSent,
        wave_count: waveOutcomes.length,
        waves: waveOutcomes,
      });
    } finally {
      await supabase
        .from("orders")
        .update({ dispatch_lock_token: null, dispatch_locked_at: null })
        .eq("id", orderId)
        .eq("dispatch_lock_token", lockToken);
    }
  }

  return { processed: (candidates ?? []).length, results };
}
