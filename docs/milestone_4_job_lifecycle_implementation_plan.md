# Milestone 4 — Job lifecycle, Realtime, maps, and live location

This document is the **implementation plan for client approval** before build starts. It covers the post-match job flow: status transitions, Supabase Realtime sync, map integration, and live provider location during an active job.

It assumes **Milestone 3 dispatch** (book → hunt → accept → `assigned`) is in place or will remain stable while M4 work proceeds.

---

## 1. Goals and non-goals

**Goals**

- **Complete job lifecycle** from customer request through completion:
  - `requested` → `accepted` → `enroute` → `arrived` → `in_service` → `completed`
- **Supabase Realtime** so customer and provider UIs reflect the same order status without manual refresh.
- **Map integration** on active jobs (customer destination + provider position + route context).
- **Live location updates** while the job is in motion or in service.
- **Deliverable:** a full **end-to-end testable flow** on staging where status changes on one device appear on the other in real time.

**Non-goals (unless explicitly added to M4 scope)**

- Payment capture, refunds, or payout reconciliation (Stripe flows stay as-is or deferred).
- Pricing engine, tier thresholds, or dispatch wave policy changes (Milestone 3 domain).
- Provider earnings dashboard, ratings UX polish beyond “job completed” handoff, or admin tooling.
- Background location on iOS/Android native apps (web/PWA foreground tracking only unless client expands scope).

---

## 2. Current codebase touchpoints (baseline)

| Area | Location | Today |
|------|----------|--------|
| Book + hunt | `app/api/orders/book/route.ts`, `lib/orders/dispatchTick.ts` | Creates `pending` / `offered`, tick advances waves |
| Accept | `app/api/orders/accept/route.ts` | First-wins → `assigned`, siblings declined |
| Status hydrate | `app/api/orders/status/route.ts` | Customer one-shot read |
| Provider transitions | `app/api/orders/transition/route.ts` | `en_route`, `arrived`, `in_progress` (guarded) |
| Complete | `app/api/rpc/complete_order/route.ts` | `completed` + optional Stripe capture |
| Ready for next | `app/api/orders/[id]/ready-for-next/route.ts` | Mid-job opt-in (M3); not required for M4 E2E unless product says otherwise |
| Customer + provider job UI | `app/page.tsx` | Matched / in-service sheets, transition buttons, partial Realtime |
| Standalone provider app | `app/provider/page.tsx` | Offers + online + location upsert; **no** full lifecycle after accept |
| Map component | `components/map-view.tsx` | MapLibre + raster tiles; used in profile picker; **not** fully wired on active job map |
| Shared types | `types/fresh-up.ts` | DB-aligned statuses; **no** `arrived` in enum |
| Realtime publication | `supabase/migrations/20260424100000_milestone3_dispatch_fields_and_orders_realtime.sql`, `20260421152000_enable_realtime_for_order_offers.sql` | `orders`, `order_offers` |

**Known gaps vs M4 requirements**

- Product labels (`requested`, `enroute`, `in_service`) do not always match DB enum (`pending`, `en_route`, `in_progress`).
- **`arrived` is used in API/UI but is not a first-class value in the DB enum** (migration required).
- Main job map does not yet consume a per-order location stream (`providerPos` / route not driven during jobs).
- Provider location today upserts **`realtime_locations`** (global online presence); blueprint also defines **`provider_realtime_locations`** with `order_id` — pick one canonical model for M4.
- Service progress on customer UI can be **simulated** until tied to server timestamps and Realtime.
- `app/provider/page.tsx` and `app/page.tsx` (provider mode) are **not** feature-equivalent for lifecycle.

Milestone 3 plan (`docs/milestone_3_dispatch_implementation_plan.md`) listed full lifecycle, maps, and live location as **deferred to M4+**.

---

## 3. Target architecture

### 3.1 Canonical status machine (database + API)

**Single source of truth:** `public.orders.status` (enum) plus timestamp columns and `order_events` audit rows.

| Product step | DB `orders.status` | Typical prior state(s) | Actor |
|--------------|-------------------|-------------------------|--------|
| Requested | `pending`, then `offered` while hunting | — | System / customer book |
| Accepted | `assigned` | `offered` (via accept) | Provider accept |
| En route | `en_route` | `assigned` | Provider |
| Arrived | `arrived` | `en_route` | Provider |
| In service | `in_progress` | `arrived` (or agreed skip policy) | Provider |
| Completed | `completed` | `in_progress` | Provider complete |
| Cancelled | `cancelled` | pre-assignment or policy | Customer / system |

**Rules**

- Transitions are **server-enforced** in `POST /api/orders/transition` and `POST /api/rpc/complete_order` (extend guards; reject illegal jumps).
- **Idempotent** transitions: repeating the same target status returns success without duplicate events.
- **`completed` only from `in_progress`** unless client approves an explicit “skip arrived” product rule documented in §9.
- Append **`order_events`** (`event_type`, `actor_id`, payload) on every transition for support and QA.

**Timestamps (orders row)**

| Column | Set when entering |
|--------|-------------------|
| `accepted_at` | Accept (existing) |
| `en_route_at` | `en_route` |
| `arrived_at` | `arrived` |
| `started_at` | `in_progress` |
| `completed_at` | `completed` |

### 3.2 Realtime contract (customer + provider)

**Channels**

- **`orders` row** — filter `id = eq.<order_id>`; both customer and assigned provider subscribe for lifecycle UI.
- **`order_offers`** — unchanged for hunt (provider inbox); out of scope except “stop hunt UI on `assigned`”.

**Client behaviour (both roles)**

1. **One-shot hydrate** on mount: `GET /api/orders/status` (or equivalent) before relying on Realtime.
2. **Subscribe** to `orders` for the active `order_id`.
3. On **reconnect / tab focus**, re-hydrate once, then resubscribe (bounded backoff).
4. **Unsubscribe** when status is terminal (`completed`, `cancelled`) or user leaves the job screen.
5. UI shows **Reconnecting…** if the channel is down beyond a short grace period.

**Server**

- Ensure `orders` (and any location table used in §3.4) are in the `supabase_realtime` publication with RLS-safe policies.
- Tick / transition routes use **service role**; Realtime consumers use **user JWT** + RLS.

### 3.3 Map integration

**Vendor (client decision — blocks map-heavy work until chosen)**

| Option | Notes |
|--------|--------|
| **A — MapLibre (current)** | Already in `components/map-view.tsx`; add routing via OSRM or similar; no Google/Mapbox SDK in repo today |
| **B — Mapbox** | Mapbox GL JS + Directions API; requires client API key and billing |
| **C — Google Maps** | Maps JavaScript API + Directions; requires client API key and billing |

**Shared UX (vendor-agnostic)**

- Customer job address pin (from `orders.customer_lat/lng` / address label).
- Provider marker updated from live location stream (§3.4).
- Optional route polyline customer ↔ provider while `en_route`.
- Fit map bounds when both points exist; degrade gracefully if GPS denied.
- **Open in external maps** link (Google/Apple) from address — does not require embedding that vendor’s SDK.

### 3.4 Live location during an active job

**When to publish (provider)**

- While `orders.status` ∈ `en_route`, `arrived`, `in_progress` for the assigned order.
- Throttle writes (e.g. every **5–15 s** or **≥ 25 m** movement) to limit DB and Realtime load.
- **Stop** publishing after `completed`, `cancelled`, or provider goes offline.

**When to consume (customer)**

- Subscribe to **order-scoped** location updates (not the global “all online providers” map used for discovery).
- Map marker + optional ETA copy; no requirement for sub-second animation in M4.

**Storage (pick one in Phase A — do not dual-write)**

- **Path 1:** extend `realtime_locations` with `order_id` + RLS, or
- **Path 2:** use `provider_realtime_locations` from blueprint migrations and wire UI + match only if still needed.

**Privacy / RLS**

- Only **customer_id** and **provider_id** on that order may read location rows for the active job.

### 3.5 UI surfaces

**Canonical M4 demo path:** `app/page.tsx` (customer mode + provider mode), reusing existing matched / in-service sheets.

**`app/provider/page.tsx`:** either brought to parity (accept → full lifecycle) or explicitly **out of scope** for M4 sign-off with a note in the demo script.

Remove or gate **demo-only** shortcuts (e.g. jump straight to `in_service`, fake progress bar) behind dev flags so acceptance tests use real transitions.

---

## 4. Schema and migrations

All migration files are **prepared in repo**; **application is manual** by the project owner (`supabase db push` or Dashboard SQL), per project policy.

1. **Enum:** add `arrived` to `order_status` (or align on a single spelling across DB, API, and UI).
2. **Columns:** `en_route_at`, `arrived_at` on `orders` if not present (transition route already tolerates missing columns on older DBs — M4 should make them canonical).
3. **Location table:** one model with `order_id`, `provider_id`, `lat`, `lng`, `recorded_at`; indexes for `(order_id, recorded_at desc)`.
4. **Realtime publication** for the chosen location table (if not already published).
5. **RLS policies** for customer/provider read on active job rows; provider insert/update own location only.
6. **`order_events`:** ensure event types cover `en_route`, `arrived`, `in_progress`, `completed` (and `ready_for_next` if in scope).

---

## 5. API surface

| Piece | Responsibility |
|--------|----------------|
| `GET /api/orders/status` | Hydrate lifecycle fields + timestamps for customer (and debug) |
| `POST /api/orders/transition` | Provider: `en_route` \| `arrived` \| `in_progress`; strict `VALID_FROM` |
| `POST /api/rpc/complete_order` | Provider: `completed` from allowed prior state |
| `POST /api/orders/accept` | Unchanged: hunt → `assigned` |
| **New or extended** `POST /api/orders/location` (or Realtime-only write via RLS) | Provider throttled location upsert for `order_id` |
| M3 routes | `book`, `dispatch_tick`, `abort-search` — no behaviour change unless a bug blocks M4 E2E |

Update `API_ROUTES.md` when M4 routes are stable (optional doc pass, not blocking client approval).

---

## 6. Rollout phases (implementation order)

| Phase | Focus | Exit criteria |
|-------|--------|----------------|
| **A — Schema & API** | Migrations (manual apply), enum + timestamps, transition/complete guards, `order_events` | Illegal transitions rejected; `arrived` persisted |
| **B — Realtime sync** | Lifecycle channel on `orders`, hydrate + reconnect on both roles | Status change on device A visible on device B without refresh |
| **C — Provider job UI** | Step buttons → API; timers from server timestamps; remove demo skip in acceptance build | Provider can drive full path in one surface |
| **D — Customer job UI** | Matched / in-service sheets from Realtime; completion + rating handoff | Customer mirror of provider steps |
| **E — Map + live GPS** | After map vendor decision: map on active job, route, order-scoped location | Customer sees provider movement during `en_route` / `in_service` |
| **F — QA & demo package** | Scripted E2E, poor-network retry, screen recording + short script | Client sign-off checklist (§8) green on staging |

**Dependency:** Phase **E** starts only after **§9.1** (map vendor) is answered.

---

## 7. Testing checklist

- **Unit:** transition matrix (allowed / forbidden); idempotent double-tap.
- **Integration:** customer books → provider accepts → both see `assigned` via Realtime.
- **Integration:** full chain `en_route` → `arrived` → `in_progress` → `completed` with events logged.
- **Integration:** complete rejected from `assigned` / `en_route` if guards tightened.
- **Realtime:** kill network on one client, restore, state matches DB after hydrate.
- **Location:** provider publishes only while in active statuses; stops after complete.
- **RLS:** third user cannot read order or location for another customer’s job.
- **Regression:** M3 hunt + accept still works; cooldown / `ready_for_next` unchanged unless explicitly tested.

---

## 8. Client acceptance criteria (sign-off)

- [ ] Customer books; provider accepts; **both** show accepted without reload.
- [ ] Provider advances **enroute → arrived → in_service → completed**; customer UI follows each step via Realtime.
- [ ] Illegal transitions return clear errors; no duplicate DB writes on repeated taps.
- [ ] During **enroute** and **in_service**, customer map shows provider movement within agreed accuracy/latency.
- [ ] After **completed**, both sides show terminal state; location publishing stops.
- [ ] Demo script executed on **staging** with two test accounts and recorded walkthrough.

---

## 9. Open questions (need client answers before / during build)

1. **Map vendor:** MapLibre (status quo) vs Mapbox vs Google — who supplies API keys and pays usage?
2. **Arrived step:** manual provider tap only vs optional auto-arrival geofence in M4 (recommend **manual tap** for first release).
3. **Location:** foreground web tracking only vs background (recommend **foreground** for M4).
4. **Skip arrived:** may provider go `en_route` → `in_progress` without `arrived` (at-provider services)?
5. **Surfaces:** is **`app/page.tsx` dual mode** the only M4 sign-off surface, or must **`app/provider/page.tsx`** match?
6. **Ready for next:** include in M4 lifecycle demo or leave as M3-only behaviour?
7. **Staging:** confirm Supabase project, test accounts, and acceptable test regions (e.g. Lahore GPS vs Oslo).

---

## 10. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Status vocabulary drift (UI vs DB) | Phase A alignment table; shared `types/fresh-up.ts` |
| Missed Realtime events | Hydrate on subscribe + on focus; show reconnect state |
| Map API cost / compliance | Client chooses vendor before Phase E |
| Two provider UIs diverge | Single canonical path in demo script (§9.5) |
| Manual migrations not applied | Checklist in Phase A handoff; no agent-applied migrations |

---

## 11. Document maintenance

- After client approval, link this plan from the main milestones doc when that file is available in repo.
- When M4 is complete, update acceptance checklist (§8) with staging URL and date of sign-off.
- Keep map vendor choice and location storage decision in **one** place (this doc + env example for keys).
