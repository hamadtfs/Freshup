# FreshUp — Work Outside / Beyond Milestone Specs

**Updated:** 22 Jul 2026  

**Sources reviewed:**
1. *FreshUp App Milestones.pdf* — mobile Expo milestones 1–6  
2. *Milestones F-up (1).pdf* — early backend matching / dispatch 1–7  
3. *FreshUp App Milestones Web.pdf* — web/backend milestones 1–6 (expanded)  
4. *FreshUp Pricing & Tier System Specification v1.0* (18 Apr 2026)  
5. *FreshUp System Architecture & Dispatch Specification v1.0* (17 Apr 2026)  

**Purpose:** Clarify what the client docs already specify vs what we built or still need that was **not named** (or only partially named) there.

---

## How to read this doc

| Status | Meaning |
|--------|---------|
| **Done** | Implemented (web and/or mobile and/or backend) |
| **Partial** | Started or web-only / mobile-only / needs polish |
| **Planned / TODO** | Not finished |

---

## 0. Explicit check: Admin / Demand zones / Ready for next

| Topic | App (mobile) PDF | F-up PDF | **Web milestones PDF** | **Pricing v1.0** | **Architecture v1.0** | Product today |
|-------|------------------|----------|------------------------|------------------|------------------------|---------------|
| **Admin panel** | No | No | **No** | **No** | **No** | **Not scoped / not built** as a milestone deliverable |
| **Demand zones map (Opptatt / heatmap overlay)** | No | No | **No** | **No** (see note) | **No** | **Yes** — `demand_zones` + map overlay |
| **Used capacity → dynamic price** | No | No | **No** | **Yes** (§2.3) | No | **Yes** — quote-bulk / multipliers |
| **Ready for next request** (named feature) | No | No | **No** (name absent) | **No** | **No** | **Yes** — UI + `/api/orders/ready_for_next` |
| **Overlapping bookings while in service** | No | No | **Yes** (M2 assumption) | No | **Conflicts** — says busy providers excluded | Implemented via ready-for-next |

### Notes on §0

1. **Admin panel** — Still **not discussed in any of the five PDFs**. If the client expects catalog/user/ops admin, that is **extra scope**.

2. **Demand zones** — Split carefully:
   - **Pricing doc** defines **used capacity** for the price multiplier (−30% … +30%). That *is* discussed.
   - **Map heatmap / Opptatt / `demand_zones` grid overlay / smoke blobs / price arrows on the map** are **not** described in these PDFs. Those are product/engineering additions on top of the capacity metric.

3. **Ready for next** — The **Web milestones PDF** says providers *can* accept other bookings during an ongoing service (overlapping). The **Architecture PDF** says busy providers are *excluded* from dispatch + recent winners get cooldown.  
   Our **Ready for next** feature is the product way to allow overlapping mid-job. The **feature name and lock UI** are **not** in the PDFs; the overlapping *business idea* appears only in the Web milestones PDF (and conflicts with Architecture busy-exclusion).

---

## 1. What the newer specs *do* cover (so not “undiscussed”)

These were missing from the first two short PDFs but **are** in Pricing / Architecture / Web milestones:

| Item | Spec source | Status |
|------|-------------|--------|
| Dynamic capacity pricing (−30%…+30%) | Pricing §2.3 | **Done** |
| Commission 20% baked into customer price (`÷ 0.80`) | Pricing §2.2 | **Done / Partial** (verify end-to-end) |
| Delivery fee base + per km; 0% commission on delivery | Pricing §2.4 | **Done** (amounts may differ by market, e.g. $15+$1/km demo) |
| Provider area typical-price at signup (trimmed mean, ≥5) | Pricing §2.1, §4 | **Partial** |
| Gold / Silver / Bronze tiers + provider-facing UI | Pricing §3; Architecture §4.5–4.6 | **Done** |
| Batch × wave dispatch (distance/rating batches + tier waves) | Architecture §4; Web M3 | **Done** |
| Hunt cap / no provider message | Architecture §4.2; Web M3 | **Done** |
| Cooldown after winning a job | Architecture §4.7 | **Partial** (verify vs ready-for-next) |
| Race-safe single accept | Architecture §4.8 | **Done** |
| Service naming standard / data cleanup | Architecture §3 | **Partial** |
| Customer ↔ provider chat, support chat, report provider | Web M1 schema + M6 | **Partial / Done** |
| Google / Apple login | Web M6 | **Done** (mobile + web paths) |
| Stripe + cards + earnings + orders pages | Web M5 | **Done** |

---

## 2. Still outside / beyond all five PDFs

### 2.1 Demand map product (beyond capacity formula)

| Item | Status |
|------|--------|
| `demand_zones` table + refresh cron | **Done** |
| Map Opptatt / smoke / heatmap overlay | **Done** (web); **Partial** (mobile) |
| Demand price arrows on service cards | **Done** |
| Admin tooling to manage zones/prices | **Not built** (and admin panel not in PDFs) |

### 2.2 Ready for next (named product)

| Item | Status |
|------|--------|
| Provider toggle / locked button during in_service | **Done** |
| API `POST /api/orders/ready_for_next` | **Done** |
| Alignment with Architecture “busy excluded” vs Web “overlapping allowed” | **Needs client confirmation** |

### 2.3 Admin panel

| Item | Status |
|------|--------|
| Ops admin (users, catalog, disputes, config) | **Not in any PDF · not delivered** |

### 2.4 Payments / wallet depth beyond specs

| Item | Status | Notes |
|------|--------|-------|
| 3DS / `requires_action` WebView on mobile | **Done** | Spec said Stripe intent; not 3DS UX |
| Instant payout + automatic payout (Oslo TZ) | **Partial / Done** | Pricing mentions Stripe Connect 80/20; wallet UX extra |
| Receipt / invoice download UI | **Partial** | |

### 2.5 Mobile / UX / ops extras

| Item | Status |
|------|--------|
| Expo mobile app (separate mobile PDF) | **Done / ongoing** |
| Restore active order on app reload | **Done** (mobile) |
| Simulated fleet cars on browse map | **Done** |
| Active job sheets (instructions, ETA, expand/collapse) | **Done** |
| Map center cache / GPS flash fixes / Force Oslo test flag | **Done** |
| Android Google Maps API key setup | **Partial** |
| Dispatch cron ops (3s vs 1m, Vault URL, pg_net log retention) | **Partial** |
| Performance (abortable quotes, debounce, fleet markers) | **Done** |
| App Store / marketing screenshot sets | **Partial** |
| Schedule a booking | **Likely deferred** (in early mobile PDF; weak in web PDF) |

---

## 3. Spec conflicts to resolve with client

| Topic | Web milestones | Architecture | Pricing | What we built |
|-------|----------------|--------------|---------|---------------|
| Busy provider during job | May take overlapping bookings | Busy **excluded** from dispatch | — | **Ready for next** enables overlap |
| Tier score weights | — | Accept 40% / Speed 30% / Complete 30%; Gold ≥0.80 | Equal average of 3 metrics; Gold ≥70% | Prefer **Pricing v1.0** as pricing doc says it takes precedence on conflicts with informal chat; Architecture may still apply to dispatch — **confirm which doc wins for tier math** |
| Batch timing | 15s batches, deployed twice, 5 min hunt | ~3s waves inside batches, 6-batch structure | Waves align to 3s/6s/9s speed points | Implemented closer to Architecture + Pricing wave model |

---

## 4. Recommended priorities

1. Confirm with client: **admin panel required or not?**  
2. Confirm: **ready-for-next / overlapping** vs Architecture busy-exclusion.  
3. Confirm: **tier formula** — Pricing v1.0 vs Architecture weights.  
4. Treat **demand map overlay** as delivered extra beyond Pricing §2.3 capacity formula.  
5. Fix **dispatch Vault URL + DB log bloat**.  
6. Finish **Android Maps key** + turn off **Force Oslo** before prod.  
7. Complete **screenshot gaps** for store/marketing.

---

## 5. One-line answers (for Slack / client)

- **Admin panel?** Not discussed in any of the five PDFs.  
- **Demand zones?** Capacity-based **pricing** is in Pricing v1.0; **map heatmap / Opptatt zones** are not. We built both.  
- **Ready for next?** Feature name not in PDFs; Web milestones allow overlapping jobs; Architecture excludes busy providers. We built ready-for-next to support overlapping.

---

*This file is the living scope delta against the milestone + architecture + pricing pack.*
