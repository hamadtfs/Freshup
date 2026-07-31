# Tier Engine — Implementation Reference

_Pricing & Tier System Spec §3 + Architecture §4.3 dispatch waves_

---

## 1. Formula (spec §3)

All three metrics use the same denominator: **offers received** (`order_offers` in the rolling window).

```
accept_rate       = accepted / received
completion_rate   = completed / received
response_speed    = total_speed_points / received
score             = (accept_rate + completion_rate + response_speed) / 3
```

**Response speed points** (aligned with Gold / Silver / Bronze wave windows):

| Response time | Points |
|---------------|--------|
| ≤ 3 seconds   | 1.0    |
| ≤ 6 seconds   | 0.5    |
| ≤ 9 seconds   | 0.25   |
| > 9 s or no response | 0 |

`completed` = provider’s jobs with `orders.status = 'completed'` in the window (`completed_at` or `accepted_at` ≥ cutoff).

---

## 2. Tier thresholds

| Tier   | Score (0–100) |
|--------|----------------|
| Gold   | ≥ 70           |
| Silver | 50 – 69        |
| Bronze | < 50           |

**Insufficient sample:** fewer than **3** offers received in 30 days → **Silver** (starter tier per §3.4).

**New provider grace (§3.4):** for **30 days after signup** (`provider_details.created_at`), tier cannot drop below **Silver**, even if computed score would be Bronze.

---

## 3. Where it runs

| Layer | File |
|-------|------|
| Shared TS (app API + tests) | `lib/providers/performance-score.ts` |
| DB refresh (hourly cron) | `refresh_dispatch_performance_tiers()` in `supabase/migrations/20260515140000_refresh_dispatch_performance_tiers_spec_v3.sql` |
| Provider API | `app/api/providers/me/route.ts` → `performanceStats` |
| Dispatch column | `provider_details.dispatch_performance_tier` |
| UI | `app/page.tsx` + `components/hamburger-menu.tsx` |

After deploying the migration, run manually:

```sql
SELECT public.refresh_dispatch_performance_tiers();
```

---

## 4. Dispatch waves

6 distance/rating batches × 3 performance tiers. **Per batch:** Gold at +0 s, Silver at +3 s, Bronze at +6 s; next batch opens +10 s (Batch 1 starts at confirm). Wave 0 runs in the book API; each later wave runs on **one** dispatch tick (cron ~every 3 s). Each provider’s offer `expires_at` is set when their wave inserts the row, so everyone gets a full 60 s from when it lands.  
See `lib/orders/dispatchTick.ts`, `lib/orders/dispatchTiming.ts`, and migration `20260602120000_restore_dispatch_tick_every_3_seconds.sql`.
