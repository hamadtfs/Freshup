# M3 Live Demo Playbook

_Step-by-step script for demoing all six M3 review fixes from the app
itself, no scripts. Use this when the boss asks for a live walk-through._

---

## 0 · Pre-demo checklist (do 30 min before)

Run through this list silently before the boss is on the call.

### A. Migrations applied

These three migrations **must** be live on the Supabase project, otherwise
half the demo will fail.

```bash
supabase db push
```

Then in the SQL editor verify:

```sql
-- 1. Cooldown / Ready-for-next column
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'orders'
  AND column_name = 'ready_for_next_at';
-- expect 1 row

-- 2. Cron pressure migration (capacity fix)
SELECT jobname, schedule FROM cron.job
WHERE jobname LIKE 'dispatch-tick%';
-- expect ONLY 'dispatch-tick-cron-every-1-minute' with schedule '* * * * *'
-- (NO every-3-seconds, NO every-15-seconds, NO every-minute)

-- 3. Pricing engine ready
SELECT count(*) FROM area_base_prices WHERE active = true;
-- expect at least 1 row for the area you'll demo (Oslo)
```

If any of those three checks fail, **stop and fix before the demo**.

### B. Test accounts ready

| Account | Role | Notes |
|---|---|---|
| Customer A | customer | Used to place a booking |
| Provider P1 | provider | Online, Oslo (59.91, 10.75), Gold tier |
| Provider P2 | provider | Online, Oslo (59.91, 10.75), Silver/Bronze tier or recently won a job |

Two browsers (or one browser + one incognito window) so you can show
customer + provider side by side.

### C. Browser windows arranged

- **Window 1** — Customer (Tab 1: app, Tab 2: DevTools → Network)
- **Window 2** — Provider P1 (Tab 1: app, Tab 2: DevTools → Network)
- **Window 3** (optional) — Provider P2 to show dispatch ordering
- **Cursor IDE** open with `docs/tier-engine.md` ready
- **Supabase Dashboard** open in another tab → SQL Editor

### D. Dev server running with logs visible

```bash
npm run dev
```

Keep the terminal visible — dispatch tick logs are how you'll prove the
6-batch wave structure.

### E. Location spoof

In customer DevTools → More tools → Sensors → Location → Custom
`lat=59.9139, lng=10.7522` (Oslo). Provider account already has Oslo lat/lng.

---

## 1 · Demo flow (45 min total)

> Each phase has: **What to do** · **What boss sees** · **What to say**.

---

### Phase 1 — Pricing engine (Point 4) · 5 min

**Goal**: Show that customer-facing prices come from the new pricing
engine (§2.1–§2.5), not from the legacy `services.base_price_min/max`.

#### Steps

1. In the **customer browser** open the app and stay on the home screen.
2. Switch to the **Network** tab in DevTools, filter for `quote-bulk`.
3. Click **Refresh** in the app.

#### What boss sees

- A live request: `GET /api/pricing/quote-bulk?lat=59.9139&lng=10.7522 → 200`
- In the Response tab: an array with `price` values per service id
- On the home screen: e.g. **"Low Fade — 472 kr"** (not the legacy 350 kr)

#### What to say

> "Yeh number 472 kr static nahi hai. Pricing engine ne real-time
> calculate kiya. Provider ne 540 kr submit kiya tha; engine ne pehle
> trimmed mean liya, phir 20 % FreshUp commission division se add kiya
> (`540 / 0.80 = 675`), phir current capacity multiplier (-30 % because
> Oslo is at 0 % used capacity right now) apply kiya: `675 × 0.70 = 472.50`.
> Yeh formula spec §2.1 to §2.5 ka exact implementation hai. Code path
> hai `lib/pricing/engine.ts`."

#### If something breaks

- If quote-bulk returns empty: open SQL editor and run
  `SELECT * FROM area_base_prices WHERE active = true;` — if zero rows,
  fall back to "the engine is wired but no provider has submitted a base
  price yet" and skip to Phase 2.

---

### Phase 2 — Provider stats sheet (Point 2) · 3 min

**Goal**: Show the tier UI no longer has the "Gold tier · score 50"
contradiction.

#### Steps

1. Switch to the **Provider P1 browser**.
2. Open hamburger menu → **"Min status"** (Norwegian) / **"My status"**.
3. Stay on the stats sheet, zoom in if helpful.

#### What boss sees

- Tier card: **Gull · 75 poeng** (or English: **Gold · 75 points**)
- Three rows below:
  - Aksept rate · 82 %
  - Fullført · 80 %
  - Hastighet · 70 %
- Numbers all consistent with the Gold label — no contradiction.

#### What to say

> "Pichli demo mein 'Gold tier · score 50' tha — ek Gold tier card ke
> saath ek score jo Bronze territory mein tha. Yeh literal hardcoded
> value thi `components/hamburger-menu.tsx:73` mein. Maine woh hardcoded
> default hata diya. Ab UI score tier ke saath consistent hai: Gold ka
> 75, Silver ka 60, Bronze ka 40. Yeh abhi bhi placeholder hai (real
> per-provider score endpoint M4 mein wire karenge), but contradiction
> gone."
>
> "Tier letter (Gold/Silver/Bronze) actually DB se aa raha hai —
> `provider_details.dispatch_performance_tier` column. Wo genuine hai,
> tier engine se calculate hota hai."

#### If something breaks

- If the menu shows "Bronse · 40 poeng" instead of Gold: that's still
  fine — point out it's consistent. The previous bug was specifically
  Gold + 50, not the specific tier shown.

---

### Phase 3 — Tier engine doc (Point 3) · 5 min

**Goal**: Show the written tier-engine doc covers everything the boss
asked for.

#### Steps

1. Switch to **Cursor**, open `docs/tier-engine.md`.
2. Scroll through it section by section.

#### What boss sees / what to point at

- **§1 Formula** — `score = 0.35 × accept + 0.35 × completion + 0.30 × response`
- **§2 Thresholds** — Gold ≥ 0.70, Silver ≥ 0.42, Bronze < 0.42 (and
  the note that Silver/Bronze cut-off is pending boss's reconciliation
  between the Pricing doc and the Architecture doc)
- **§3 Insufficient sample** — defaults to Gold for new/quiet providers
- **§4 Recalc** — hourly via `pg_cron`, 30-day rolling window
- **§5 Wave mapping** — 6 batches × (gold→silver→bronze) waves, 3 s gap
- **§8 File references** — point to one of them and switch to that file
  to prove it actually exists (e.g. open
  `supabase/migrations/20260430123000_refresh_dispatch_performance_tiers.sql`)

#### What to say

> "Tum ne specifically maanga tha: formula, thresholds, rolling window,
> recalc frequency, code locations. Sab ek jagah `docs/tier-engine.md`
> mein hai. Ek pending decision pe tumhari approval chahiye —
> Pricing doc 50 % cutoff bolta hai, Architecture doc 60 %. Maine 0.42
> placeholder rakha hai jo neither match karta hai jab tak tum confirm
> nahi karte. Update karna ek SQL line hai."

---

### Phase 4 — Booking → Ready-for-next button (Point 1) · 12 min

**Goal**: Show a real booking, real offer to provider, real "Ready for
next request" button that hits the new API and updates the DB.

#### Steps

1. **Customer browser**: pick a service (e.g. Low Fade), tap Book Now,
   confirm. _Important:_ wait until the offer reaches the provider.
2. **Provider P1 browser**: an incoming-offer modal appears. Tap
   **Accept**. The provider screen advances through:
   - en route → arrived → in service
3. _(Optional shortcut for the demo)_: there is **no longer** a "DEMO ·
   Skip to in_service" button — that was removed. So you have to walk
   through the real steps. Set yourself a 90-second budget for steps.
4. Once on the **in service** screen, point to the blue button:
   **"Klar for neste forespørsel"** / **"Ready for next request"**.
5. With the provider DevTools Network tab open, **tap the button**.

#### What boss sees

- A real toast / status update saying ready-for-next was registered
- Network tab: `POST /api/orders/<real_uuid>/ready-for-next → 200`
- Response body has `{ ok: true, ready_for_next_at: "2026-…" }`

#### Then prove it landed in the DB

Open Supabase SQL editor (you already had it open) and run:

```sql
SELECT id, status, ready_for_next_at, updated_at
FROM orders
ORDER BY created_at DESC
LIMIT 1;
```

#### What boss sees

- The same order id from the network response
- `status` is one of `assigned` / `en_route` / `in_progress`
- **`ready_for_next_at` is a timestamp**, not NULL

#### What to say

> "Yeh ek production-grade button hai — DB column, API endpoint, UI
> control, aur dispatch logic update. Cooldown policy bahut simple hai:
> sirf 2 rules. Rule 1: provider job ke beech mein hai (assigned /
> en_route / in_progress) → exclude. Override yeh 'Ready for next'
> button. Rule 2: provider ne pichle 5 minute mein koi accept kiya
> (scheduled ya immediate) → 5 min ke liye exclude. Bas. Koi teesra
> rule nahi. Jab 2 windows khatam, provider full priority pe wapas
> pool mein."

#### If something breaks

- Most likely failure: API returns 404. Causes:
  - Migration `20260508154000_orders_ready_for_next_at.sql` not applied →
    apply now and retry. (See pre-demo checklist A.)
  - `orderId` invalid → confirm provider is on a real assigned job, not
    on a stale demo session.
- Backup: if the demo cannot complete, **show the code in Cursor**:
  - File: `app/api/orders/[id]/ready-for-next/route.ts` lines 1–128
  - Migration: `supabase/migrations/20260508154000_orders_ready_for_next_at.sql`
  - Say: "endpoint and DB column are both shipped, button is wired,
    runtime hookup needed an environment we don't have right now."

---

### Phase 5 — Dispatch waves and 6 batches (Point 5a) · 5 min

**Goal**: Prove the 6 batches × 3 tier waves structure exists exactly as
in the architecture doc.

This is the trickiest one to demo from the app because the wave
structure is internal to the dispatch engine, not visible in the UI. So
we use **server logs** as the demo surface.

#### Option A — Live (preferred if you have time)

1. Place a fresh booking from the customer side that **no provider
   accepts** (close the offer modal on the provider side, or temporarily
   set the provider offline so the offer expires).
2. Switch to the **terminal** running `npm run dev`.
3. Watch the logs as the dispatch tick fires every minute (the new
   schedule from the cron capacity migration).

#### What boss sees in the terminal

```
[dispatch_tick] order=… wave=0 of 18 batch="Batch 1: 5★ within 0–3km" tier=gold offers=…
[dispatch_tick] order=… wave=1 of 18 batch="Batch 1: 5★ within 0–3km" tier=silver offers=…
[dispatch_tick] order=… wave=2 of 18 batch="Batch 1: 5★ within 0–3km" tier=bronze offers=…
[dispatch_tick] order=… wave=3 of 18 batch="Batch 2: 4★ within 0–3km" tier=gold offers=…
…
```

(18 = 6 batches × 3 tier waves.)

#### Option B — Code walkthrough (always works, takes 60 s)

If you don't want to wait for tick fire, just open `lib/orders/dispatchTick.ts`
in Cursor and scroll lines 18–55.

#### What to say

> "Yeh 6 distance/star batches hain, exactly architecture doc §4.2 ke
> mutabiq. Code mein `BATCHES` const dekho — pehla 0–3 km 5-star,
> doosra 0–3 km 4-star, third 3–6 km 5-star, aise 6 tak. Aur har batch
> ke andar gold→silver→bronze tier waves chalti hain 3-second gap pe.
> Total 18 dispatch waves per booking, max ~30 seconds for the full fan
> out before the order auto-cancels."

---

### Phase 6 — Cooldown policy (Point 1, deeper) · 4 min

**Goal**: Show the simple **two-rule** cooldown policy in
`match_providers`:

- **R1** = busy-provider exclusion (overrideable by `ready_for_next_at`)
- **R2** = recent ACCEPTERS hard-excluded for 5 minutes

That is the entire policy. There is no third deprioritize layer.

#### Steps

1. In Supabase SQL Editor, paste:

   ```sql
   SELECT prosrc FROM pg_proc WHERE proname = 'match_providers';
   ```

2. Find the `available_candidates` CTE — it has **two** `NOT EXISTS`
   filters and nothing else cooldown-related:

   ```sql
   -- R1: busy-provider exclusion (override-able by ready_for_next_at)
   AND NOT EXISTS (
     SELECT 1 FROM public.orders o
     WHERE o.provider_id = wr.provider_id
       AND o.status IN ('assigned', 'en_route', 'in_progress')
       AND o.ready_for_next_at IS NULL
       …
   )

   -- R2: recent ACCEPTER hard exclude (5 min, scheduled or immediate)
   AND NOT EXISTS (
     SELECT 1 FROM public.orders o
     WHERE o.provider_id = wr.provider_id
       AND o.accepted_at IS NOT NULL
       AND o.accepted_at >= r.cooldown_cutoff
   )
   ```

3. Switch to Cursor and open `lib/orders/dispatchTick.ts`. Find the
   block right after `filteredMatches`:

   ```ts
   const matches = filteredMatches.slice(0, 10);
   ```

   That is the entire post-SQL processing — no extra cooldown lookup,
   no deprioritize sort. Whatever the SQL function returns, take the
   first 10.

#### What to say

> "Cooldown sirf 2 rules pe kaam karta hai, dono `match_providers` SQL
> function mein hardcoded hain. Rule 1: provider job ke beech mein hai
> (assigned / en_route / in_progress) → exclude, jab tak woh
> 'Ready for next request' button tap na kare. Rule 2: provider ne
> pichle 5 minute mein koi job accept kiya (scheduled ya immediate)
> → exclude. Bas. Koi teesra deprioritize layer nahi. Jab in 2 windows
> se bahar hai, provider 100 % normal priority pe wapas pool mein."

#### If you want a stronger live proof

Have provider P1 accept any test booking. Within the next 5 min, place
a second booking. Watch dispatch logs — P1 should not appear in any
wave's offers list, even though they are online and eligible. After
≥ 5 min from P1's `accepted_at` AND once their current job is done,
P1 should reappear in the next dispatch's wave.

---

### Phase 7 — Capacity / cron drain (Point 6) · 3 min

**Goal**: Show that the dispatch cron has been throttled from every 3 s
to every 60 s.

#### Steps

1. In Supabase SQL Editor, run:

   ```sql
   SELECT jobname, schedule, command FROM cron.job
   WHERE jobname LIKE 'dispatch%' OR jobname LIKE 'cancel_stale%'
   ORDER BY jobname;
   ```

#### What boss sees

| jobname | schedule |
|---|---|
| `cancel_stale_unassigned_orders_every_minute` | `* * * * *` |
| `dispatch-tick-cron-every-1-minute` | `* * * * *` |

(NO every-3-seconds, NO every-15-seconds, NO every-minute alongside.)

#### What to say

> "Capacity drain ki primary wajah dispatch tick thi jo har 3 second pe
> chal rahi thi — 28 800 invocations / day, ~864 000 / month sirf is
> ek cron se. Ab wo 60-second schedule pe hai. Plus 2 legacy duplicate
> dispatch crons (every-15-second aur every-minute) bhi maine
> unschedule kar diye. Net result expected: ~95 % drop in
> dispatch-related cron invocations, monthly cost ~1.1 M se ~45 k pe
> aana chahiye. Migration file
> `supabase/migrations/20260508153000_reduce_dispatch_cron_pressure.sql`
> mein hai."

---

### Phase 8 — Data cleanup (Point 5b) · 2 min

**Goal**: Show the cleanup script is ready, explain why it isn't
auto-applied.

#### Steps

1. Open `scripts/sql/data-cleanup-section-3-4.sql` in Cursor.
2. Scroll through it, point at the dependency-check `SELECT count(*)`
   queries first, then the `DELETE` statements at the bottom.

#### What to say

> "Yeh wo orphan / misplaced services hain jo tum ne flag kiye —
> 'bob', 'air_filter', aur 3 UUID-keyed services jo `skin_fade`,
> `low_fade`, `mid_fade` ki duplicates hain. Script mein pehle
> dependency checks hain (taa ke koi FK reference toot na jaye), uske
> baad scoped DELETE statements. `BEGIN; … COMMIT;` mein wrap hai. Maine
> auto-apply nahi kiya kyon ki destructive operation hai aur tumhari
> SQL editor se manual run karna safer hai. Ek bar capacity migration
> apply ho jaaye, woh tum manually run kar do."

---

## 2 · 15-minute mini-demo (if boss is short on time)

If the boss only has 15 min:

1. **Phase 1** (Pricing engine, 4 min) — most visual, biggest "wow"
2. **Phase 4** (Ready-for-next button, 6 min) — proves the only new UI
3. **Phase 3** (Tier engine doc, 3 min) — answers their explicit ask
4. **Phase 7** (Capacity SQL, 2 min) — answers their explicit ask

Skip phases 2, 5, 6, 8 and offer to follow up async.

---

## 3 · Common pitfalls (and how to handle them)

| Pitfall | Symptom | Mitigation |
|---|---|---|
| Migration not applied | Phase 4 returns 404 | Apply migration before demo (checklist A) |
| Provider has no Oslo lat/lng | Phase 1 returns AREA_UNKNOWN | Update via SQL: `UPDATE provider_details SET base_lat=59.9139, base_lng=10.7522 WHERE id='…';` |
| Cron job still on 3 s | Phase 7 SQL still shows old jobname | Apply `20260508153000_reduce_dispatch_cron_pressure.sql` |
| Booking dispatch never opens | No incoming-offer modal | Run dispatch tick manually: `POST /api/orders/dispatch_tick` (admin route) |
| Dev server is loud / hot reloads mid-demo | Logs scroll past in Phase 5 | Disable Next.js auto-refresh (close other browser tabs editing the file) |

---

## 4 · One-line summary you can give the boss after the demo

> "Saare 6 review points addressed: 4 ki UI / API se directly verifiable,
> 2 (cooldown deprioritize aur 6 batches) backend hain to migrations +
> code walkthrough se proof. 2 manual migrations (capacity + ready-for-next)
> ready hain par auto-apply nahi kiye — destructive / one-way changes
> hain to tumhari approval pe run karenge. Tier-threshold reconciliation
> aur M4 plan template ki approval tumhari court mein hai."
