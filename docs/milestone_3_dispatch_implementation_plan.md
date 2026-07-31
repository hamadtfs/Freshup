# Milestone 3 — Dispatch system implementation plan

This document is the working plan for **batch + sequential dispatch**, **15s offer windows**, **two passes per batch**, **5 minute hunt cap**, and **single-provider accept**. It aligns with `docs/fresh_up_app_milestones_markdown.md` (Milestone 3) and the corrected **5★ / 4★** constraint wording.

---

## 1. Goals and non-goals

**Goals**

- One assigned provider per order (first-wins accept).
- Sequential waves: issue offers only for the **current** batch; expire or advance on a timer.
- Dispatch proceeds as a **fixed wave sequence** (see §4) where each wave defines `min_rating` + `max_distance_km`.
- Waves may “cycle” back to earlier tiers (e.g. re-offer higher-quality tiers) but must stop at the 5 minute hunt cap.
- Each wave: **~15s** active pending offers, then reassess (no accept → repeat or next batch).
- Global hunt cap: **5 minutes** from hunt start → cancel unassigned order and expire pending offers.
- Durable audit trail: order + offers + events for debugging and disputes.

**Non-goals (defer to Milestone 4+)**

- Full job lifecycle (enroute → completed) beyond assignment.
- Map / live location.
- Payment capture.

---

## 2. Current codebase touchpoints (baseline)

- **Book:** `app/api/orders/book/route.ts` — creates `orders`, snapshots add-ons, calls `dispatchOrderById`.
- **Dispatch v1:** `lib/orders/dispatchOrder.ts` — single RPC call, inserts **all** matches as `order_offers`, sets `offered`.
- **Batch prototype:** `lib/orders/dispatch_tick.ts` + `app/api/orders/dispatch_tick/route.ts` — batch config and iteration logic partially exist; not wired to booking + scheduler.
- **Accept:** `app/api/orders/accept/route.ts` — first-wins claim, decline siblings.
- **Abort:** `app/api/orders/abort-search/route.ts` — customer cancels hunt.
- **Customer UI:** `app/page.tsx` — polls `/api/orders/status` while waiting.
- **Provider UI:** `app/provider/page.tsx` — realtime on `order_offers` (verify column names vs `orders` schema).

---

## 3. Target architecture

### 3.1 Durable state machine (database)

Extend **`orders`** (or add a sidecar table if you prefer normalization) with dispatch fields, for example:

| Field | Purpose |
|--------|--------|
| `dispatch_started_at` | Hunt start (for 5 min cutoff) |
| `dispatch_deadline_at` | Optional explicit cutoff timestamp |
| `dispatch_wave_index` | Which wave in the fixed sequence (0..n-1) |
| `dispatch_wave_started_at` | When current wave began (debug + safety) |
| `dispatch_version` or `updated_at` | Optimistic concurrency / debugging |

**Rules**

- Book creates order in `pending`, sets `dispatch_started_at`, initializes batch index / wave counter.
- First wave of offers may run in the same process as book **or** on first tick (choose one; prefer **first tick** so book stays fast and all timing uses one code path).

### 3.2 Orchestration (must run outside the HTTP request)

Dispatch **cannot** rely on `setTimeout` in a single Next.js request (serverless timeouts, multiple instances).

**Pick one:**

1. **Scheduled worker** — cron (e.g. every 10–15s) calls `POST /api/orders/dispatch_tick` with a shared secret or Vercel cron, processing orders in `pending`/`offered` that need advancement; **or**
2. **Queue** — enqueue `dispatch_advance` jobs per `order_id` with `run_at` (better at very large scale).

Recommendation for this repo: start with **(1)** plus idempotent tick logic; migrate to **(2)** if queue volume demands it.

**Cron auth contract (recommended)**

- Require a header `x-dispatch-secret: $DISPATCH_TICK_SECRET` on `POST /api/orders/dispatch_tick`.
- Store `DISPATCH_TICK_SECRET` as an environment variable (server-side only).
- Return `401` if missing/invalid; do not leak expected value in logs.

### 3.3 Per-tick algorithm (idempotent)

For each eligible order (single transaction or ordered steps with advisory lock on `order_id`):

**Eligibility (what the tick should select)**

- Status in: `pending` or `offered`
- `provider_id` is null
- `dispatch_deadline_at` is null OR `dispatch_deadline_at > now`
- And either:
  - There are **no** `order_offers` in `pending` with `expires_at > now` (i.e. no active offer window), OR
  - The order has never issued offers yet (first wave)

Implementation note: the tick should be safe to run more often than 15s; the “active pending offers” check prevents advancing too early.

1. If `provider_id` set or status terminal → skip.
2. If `now > dispatch_deadline` (5 min) → cancel order, expire pending offers, emit event → done.
3. If there are **pending** `order_offers` with `expires_at > now` → **wait** (still inside 15s window); skip.
4. If pending offers exist but **expired** → mark them `expired` (if not already), then continue.
5. If no accept yet:
   - Advance `dispatch_wave_index` to the next row in the **fixed wave sequence** (see §4). If already at the final wave, cancel / “no provider” policy.
6. **Match RPC:** `match_providers` must accept `p_max_distance_km` and `p_min_rating` per wave row. Exclude providers already notified in this hunt (see §4).
7. Insert **only** new `order_offers` for this wave (subset size policy: cap N providers per wave if needed, e.g. top K by distance/rating).
8. If no matches in this wave and no more waves → cancel or leave policy (product: “no provider”).
9. Set order `status` to `offered` when any pending offer exists; keep `pending` only if zero offers ever (optional policy).

### 3.4 Offer row contract

- `expires_at` = now + **15s** (or milestone-specified duration).
- `offered_price` = order price snapshot.
- `status`: `pending` → `accepted` | `declined` | `expired`.

### 3.5 Accept path

Keep existing **atomic claim** on `orders` (`provider_id` null, status in allowed set). No change to first-wins semantics; optionally add `order_events` for analytics.

### 3.6 Customer UX

- **Target:** Supabase Realtime subscription on `orders` for this `order_id` (filter `customer_id` + RLS).
- **Remove polling:** do **not** poll `/api/orders/status` in the customer UI once Realtime is in place.
- **Robustness requirements**
  - Do a **one-shot fetch** on page mount to hydrate the latest order state, then rely on Realtime for updates.
  - Handle **disconnects/reconnects** (network drop, tab sleep, server restart) by showing a “Reconnecting…” state and resubscribing.
  - On reconnect (or app foreground / tab focus), do another **one-shot fetch** to close any missed-event gap.
  - Use bounded **backoff** for repeated reconnect attempts; avoid hot-looping.
  - If Realtime is unavailable for an extended window (e.g. \(>30–60s\)), keep the UI usable (status banner + retry) rather than silently stalling.
- On `assigned`, stop hunt UI and transition to matched state.

### 3.7 Provider UX

- Fix any **schema drift** in provider UI (`delivery_mode` vs `mode`, `price` vs `price_est`, etc.) so distance/payout reflect real columns.
- Realtime on `order_offers` remains valid; ensure new waves insert rows providers can see.

---

## 4. Matching rules (dispatch waves)

### 4.1 Dispatch wave sequence (max 20 waves)

| Wave | Rating | Max Distance (km) | Cycle | Notes |
|------|--------|------------------:|:-----:|------|
| 1 | 5⭐ | 3 | 1 | Highest priority |
| 2 | 5⭐ | 6 | 1 | Expand radius |
| 3 | 5⭐ | 10 | 1 | Full reach (top tier) |
| 4 | 4⭐ | 5 | 1 | Slight downgrade |
| 5 | 4⭐ | 10 | 1 | Wider fallback |
| 6 | 3⭐ | 5 | 1 | Acceptable tier |
| 7 | 3⭐ | 10 | 1 | Last reliable tier |
| 8 | 5⭐ | 3 | 2 | Re-offer cycle |
| 9 | 5⭐ | 6 | 2 |  |
| 10 | 5⭐ | 10 | 2 |  |
| 11 | 4⭐ | 5 | 2 |  |
| 12 | 4⭐ | 10 | 2 |  |
| 13 | 3⭐ | 5 | 2 |  |
| 14 | 3⭐ | 10 | 2 |  |
| 15 | 5⭐ | 3 | 3 | Final high-quality push |
| 16 | 5⭐ | 6 | 3 |  |
| 17 | 5⭐ | 10 | 3 |  |
| 18 | 4⭐ | 5 | 3 |  |
| 19 | 4⭐ | 10 | 3 |  |
| 20 | 2⭐ | 10 | Final | Last fallback (one-time only) |

### 4.2 Wave rules

- Up to **10 providers per wave**
- Exclude **rejected** + **already-notified** providers for that order
- **15 seconds** per wave
- Stop immediately if **accepted**
- Max **20 waves** total (≈ **5 minutes**)

### 4.3 Rating constraints

- **Ignore ≤2★ if better exists:** do not offer to ≤2★ providers unless the wave itself is explicitly a ≤2★ fallback and no better providers remain eligible.
- **1★ never gets jobs:** 1★ providers must never be returned by the matching RPC for dispatch.

**Exclusions**

- Maintain a set of `provider_id`s already given an offer for this `order_id` (any status). If a provider **declines**, they are **out for this order** and must not be re-offered in later waves.

Providers should also be excluded if they were already notified in any earlier wave for the same order.

---

## 5. Schema and migrations

1. Add dispatch columns to `orders` (if not present): `dispatch_started_at`, `dispatch_batch_index`, `dispatch_wave_in_batch`, `dispatch_deadline_at` (and optionally `current_batch_iteration` naming consistent with code).
2. Ensure `order_status` enum allows `pending`, `offered`, `assigned`, `cancelled` (and any others in use).
3. Index for tick worker: e.g. partial index on `(status, dispatch_deadline_at)` or `(status, updated_at)` WHERE status in (`pending`,`offered`) and `provider_id` IS NULL.
4. Review RLS: tick route uses service role; customer/provider reads must remain safe.

---

## 6. API surface

| Piece | Responsibility |
|--------|----------------|
| `POST /api/orders/book` | Create order, init dispatch fields, **do not** fan-out all providers; optionally enqueue or rely on cron for first tick. |
| `POST /api/orders/dispatch_tick` | Internal/cron: process due orders (**requires** `x-dispatch-secret`). |
| `POST /api/orders/accept` | Unchanged semantics. |
| `POST /api/orders/abort-search` | Customer cancel; compatible with batched offers. |
| `GET /api/orders/status` | Keep for **initial hydration** + debugging (customer UI should not poll); may return `dispatch_wave_index` for debugging. |

---

## 7. Testing checklist

- **Unit:** state transitions (wave repeat, batch advance, timeout at 5 min).
- **Integration:** two providers same order—only one accept succeeds.
- **Integration:** offer expires, second wave same batch, then batch advance.
- **Load:** many concurrent orders; tick completes without double-issuing (advisory lock test).
- **RLS:** customer sees only own order; provider sees only own offers.

---

## 8. Rollout phases

1. **Phase A:** Schema + dispatch fields; book stops calling monolithic `dispatchOrderById` full fan-out; first wave only via tick.
2. **Phase B:** Cron triggers `dispatch_tick` every 10–15s; align offer TTL 15s with tick granularity.
3. **Phase C:** Customer Realtime on `orders`; **remove polling** and implement reconnect + resubscribe + one-shot rehydrate on reconnect.
4. **Phase D:** Provider UI schema alignment + observability (`order_events`).

---

## 9. Open questions (need your answers)

1. **Max ~20 requests** is defined as: **max 20 waves** dispatched per order hunt.
2. **Providers per wave** is defined as: **up to 10 providers** per wave, excluding rejected and already-notified providers for that order.
3. **Declined offers** policy is defined as: **no re-offer**; once declined, that provider is out for this order.
4. **Book API** policy is defined as: return **immediately after order creation** (dispatch proceeds via tick/worker).
5. **`match_providers` RPC** requirement is defined as: provider exclusions (already-notified + declined) should be handled **inside the RPC**.

---

## 10. Document maintenance

- When Milestone 3 is done, update the main milestones doc **Deliverable** with links to the final API + cron setup.
- Keep batch distance/rating table in **one** source (TS const or DB config) shared by tick and docs.
