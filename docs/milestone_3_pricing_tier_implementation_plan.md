# Milestone 3 - Pricing and Tier System (v1.0) alignment plan

This document is the implementation plan for client approval before we continue build work against FreshUp_Pricing_and_Tier_System_v1_0 (April 18, 2026).

It is written so you can confirm that our planned changes match the specification and that you have no objections to the assumptions or open decisions listed below. No further pricing or tier alignment code ships until this plan is approved.

Related context: Milestone 3 dispatch behaviour is described in docs/milestone_3_dispatch_implementation_plan.md. Tier dispatch wiring is summarised in docs/tier-engine.md. A prior client note in docs/m3-client-letter.md described the pricing engine as largely ready; this plan reconciles that message with remaining gaps between the live app and the v1.0 document.

---

## 1. Goals and non-goals

**Goals**

- Align customer-facing prices, provider quotes, delivery, add-ons, and booking totals with the v1.0 document sections 2.1 to 2.5 end-to-end (not only in the pure math module).
- Align performance tiers and dashboard score display with section 3 (and dispatch use of tiers already in Milestone 3), after you confirm which threshold table is authoritative.
- Close UI and API drift (delivery mode, currency display, price lock, off-peak labelling).
- Leave a verifiable demo path on staging: provider submits a base price, customer sees the spec formula, and book honours the same numbers.

**Non-goals (unless you add them to this approval)**

- Milestone 5 campaign, promo, or discount layer on top of base pricing.
- Changing dispatch batch distance or rating tables (Architecture doc) except where section 3.1 cooldown or ready-for-next already touches match_providers.
- Payment capture, payouts, or Stripe reconciliation.
- Re-writing the entire catalog or service hierarchy.

---

## 2. Source document map

| Spec section | Topic | This plan |
|--------------|--------|-----------|
| 2.1 | Area buckets, provider base inputs, trimmed mean, 5-provider activation | Phase A, B |
| 2.2 | 20% commission via division (customer = provider / 0.80) | Phase B (enforce everywhere) |
| 2.3 | Used capacity to multiplier -30% to +30%; refresh cadence; price lock during booking | Phase B, C |
| 2.4 | Delivery fee 150 + 10 per km, 100% to provider | Phase C |
| 2.5 | Add-ons: same commission split as main service | Phase C |
| 3 | Tier formula, thresholds, rolling window, dispatch ordering | Phase D |
| 3.1 | Cooldown or mid-job availability | Already in codebase; verify only in QA |
| 3.4 | Service catalog data cleanup | Phase E (manual SQL, owner-run) |

---

## 3. Current baseline (already in the repository)

The following exist today and are treated as the foundation we extend, not throw away:

| Layer | Location | Status |
|-------|----------|--------|
| Pure pricing math 2.1 to 2.5 | lib/pricing/engine.ts, lib/pricing/constants.ts | Implemented |
| Server quote pipeline | lib/pricing/server.ts | Implemented; edge-case defaults need spec sign-off |
| Pricing DDL and RPCs | supabase/migrations/20260508122536_pricing_system.sql | Migration file prepared; apply is manual |
| Provider base submit API | app/api/pricing/submit-base/route.ts | Implemented |
| Customer quote APIs | app/api/pricing/quote/route.ts, quote-bulk/route.ts | Implemented |
| Price lock API and book consumer | app/api/pricing/lock/route.ts, app/api/orders/book/route.ts | API only; customer UI does not call lock yet |
| Provider skills and price UI | components/skills-page.tsx | Submits section 2.1 prices |
| Customer catalog pricing | app/page.tsx | Uses quote-bulk; gaps vs sections 2.3 and 2.4 |
| Tier refresh and column | supabase/migrations/20260430123000_refresh_dispatch_performance_tiers.sql | Implemented; Silver and Bronze bands pending your decision |
| Tier dispatch waves | lib/orders/dispatchTick.ts | Implemented |
| GPS and dynamic area cells | lib/pricing/areas.ts, 20260511123000_pricing_dynamic_areas.sql | Dev-friendly extension beyond the 10 seeded NO cities |

Honest scope note: Core formulas and tables for section 2 are largely present. What is not yet fully aligned is the product path (what the customer sees, books, and pays) and section 3 display and threshold consistency.

---

## 4. Known gaps (why this plan exists)

These are the deliberate targets of the work after your approval:

1. Price lock (section 2.3): Lock row and book price_lock_id exist; the main customer flow does not create a lock before POST /api/orders/book, so mid-flow drift is still possible.
2. Delivery (section 2.4): Engine supports 150 + 10 per km, but bulk quotes default to at-provider mode; home delivery often quotes 0 km before a provider is assigned; the booking UI uses a flat 150 helper, not the spec formula.
3. Add-ons (section 2.5): Engine splits commission correctly; some book or fallback paths still sum extra_price without the section 2.5 split; UI totals may not match API totals.
4. Currency display: English UI shows NOK divided by 10 as dollars (demo conversion), not a spec-defined FX rule.
5. Legacy fallback: When fewer than five providers have submitted in an area, customer prices fall back to services.base_price_min and base_price_max; dev env may use PRICING_DEV_MIN_PROVIDERS=1.
6. Capacity edge cases: SQL compute_used_capacity returns 0% when no online providers; the app layer sometimes uses 50% (neutral multiplier). Active booking statuses counted may omit offered or en_route.
7. Areas: Named 10 Norwegian cities plus auto gps_* cells for pins outside those radii; confirm whether non-NO test pins are in scope for production.
8. Provider price grain: provider_price_inputs is one row per provider and service; moving between areas may overwrite the same row. Confirm if the spec requires per-area inputs.
9. Tier thresholds (section 3): Gold at or above 70% matches the Pricing doc; Silver and Bronze cut-offs in SQL do not match either the Pricing doc (50% to 69% and below 50%) or the Architecture doc (60% to 79% and below 60%) bands today.
10. Tier label vs score: Dashboard tier comes from DB refresh; score is computed per request. They can diverge until aligned.
11. Section 3.4 catalog cleanup: scripts/sql/data-cleanup-section-3-4.sql is review-only; not executed on your database until you run it manually.

---

## 5. Target behaviour (acceptance-oriented)

After implementation, we will demonstrate:

### Section 2 pricing

- Provider saves a typical price per active service; area resolved from GPS (named city or approved area policy).
- Area base price is trimmed mean (10% tails) with activation at 5 or more provider inputs (unless you approve a different rule for small samples).
- Customer list price is base times (1 + multiplier) then divided by 0.80 for service; delivery and add-ons follow sections 2.4 and 2.5.
- Multiplier from used capacity over the last 30 minutes, with customer refresh on a 5 to 10 minute cadence (not per keystroke).
- When the customer starts booking, the displayed total is locked (15-minute TTL) and book copies that snapshot.

### Section 3 tier

- Single agreed threshold table drives SQL tier assignment, dispatch tier waves, and dashboard tier label.
- Dashboard score uses the documented 35% / 35% / 30% formula over 30 days; when data is insufficient, behaviour matches your written policy (today: default Gold for new providers; confirm).
- Cooldown and ready for next behaviour remains as shipped for M3; regression-tested only.

---

## 6. Rollout phases (implementation order)

| Phase | Focus | Primary surfaces | Exit criteria |
|-------|--------|------------------|---------------|
| A - Spec decisions | Lock open questions in section 9 | This doc and your written replies | No ambiguous threshold, area, or currency policy |
| B - Quote integrity | Single source of truth for card, lock, and book | lib/pricing/server.ts, quote, lock, and book routes, app/page.tsx | Same service shows the same breakdown on card, lock, and order |
| C - Delivery and add-ons | Sections 2.4 and 2.5 through UI and book | app/page.tsx, app/api/orders/book/route.ts, quote-bulk | Home vs at-provider changes totals per spec; add-ons use commission split on all paths |
| D - Tier alignment | Section 3 thresholds and UI consistency | Tier SQL migration, /api/providers/me, hamburger-menu.tsx | Tier label and score bands match the doc you select |
| E - Data hygiene | Section 3.4 cleanup | scripts/sql/data-cleanup-section-3-4.sql | Orphan services removed after your manual run and verification |
| F - QA and demo | Staging script | docs/m3-demo-playbook.md (update if needed) | Checklist in section 8 green |

Dependency: Phase D starts only after question 9.1 (threshold source) is answered. Phase E is manual SQL by the project owner, not auto-applied by the agent.

---

## 7. Files and systems we expect to touch

| Area | Files or systems |
|------|------------------|
| Pricing engine | lib/pricing/engine.ts, constants.ts, server.ts, areas.ts |
| APIs | app/api/pricing/*, app/api/orders/book/route.ts |
| Customer UI | app/page.tsx |
| Provider UI | components/skills-page.tsx |
| Tier | supabase/migrations/*refresh_dispatch_performance_tiers*, app/api/providers/me/route.ts, components/hamburger-menu.tsx |
| SQL (manual) | New migration files for tier thresholds, capacity, or area grain if decisions require schema change; scripts/sql/data-cleanup-section-3-4.sql |
| Docs | This file; optional short update to docs/tier-engine.md after sign-off |

Migration policy: We may author migration SQL in the repo. Applying migrations (supabase db push, and similar) remains manual by you, per project policy.

---

## 8. Client acceptance checklist (sign-off)

Please confirm each item on staging after we implement:

1. Provider base price in area A affects customer quote in A but not a distant area B.
2. With 5 or more provider inputs, base_price_source is computed, not legacy catalog fallback.
3. Commission example: provider 540 kr at 0% capacity gives customer service price 472.50 kr (times 0.70 then divided by 0.80).
4. Starting booking creates a price lock; completing book uses that total; expired lock forces re-quote.
5. Home delivery adds 150 + 10 per km (when km is known per agreed policy); at-provider adds 0 delivery.
6. Add-on totals match section 2.5 split on the order record.
7. Customer UI shows NOK (or your approved currency rule), not an undocumented demo dollar scale.
8. Tier label and score follow the one threshold table you selected in question 9.1.
9. No regression to M3 dispatch accept, cooldown, or ready-for-next.

---

## 9. Open questions (need your answers before or during build)

1. Tier thresholds (blocking Phase D): Final authority is Pricing and Tier System v1.0 section 3 (Gold at or above 70%, Silver 50% to 69%, Bronze below 50%) or Architecture section 4.3 (Gold at or above 80%, Silver 60% to 79%, Bronze below 60%)? We will implement one table only.
2. Trim at small samples (section 2.1): With exactly five providers, floor(10% times n) equals 0 trimmed rows. Keep no trim until ten inputs, or force at least one outlier dropped per end?
3. Capacity when denominator is zero (section 2.3): Prefer 0% used capacity (-30% multiplier), 50% neutral (0% multiplier), or another default?
4. Active bookings in capacity: Should offered, en_route, and arrived count toward the 30-minute numerator?
5. Area policy: Production Norway cities only, or keep gps_* cells for arbitrary coordinates (for example Lahore test pins)?
6. Provider price grain: One price per service globally per provider, or per service and area row?
7. Five-provider rule in production: Strict 5 minimum to activate aggregates, or a temporary lower threshold for pilot markets?
8. Customer currency: Always NOK in UI, or English locale with a documented conversion rule?
9. Home delivery km before match: Quote 0 km until assign, use customer to area centre, or hide home fee until provider known?
10. Section 3.4 cleanup: Approve running scripts/sql/data-cleanup-section-3-4.sql on staging or production in the next maintenance window?

---

## 10. Assumptions (please object if any are wrong)

- The v1.0 PDF sections 2.1 to 2.5 formulas in lib/pricing/engine.ts are the correct interpretation unless you send errata.
- Price lock TTL of 15 minutes remains acceptable for a single booking session.
- Dynamic multiplier refresh on the customer home screen every 5 minutes satisfies the 5 to 10 minute rule in section 2.3.
- Tier affects dispatch ordering, not the section 2 price formula, unless the PDF states otherwise in a section we should re-read.
- Milestone 5 promos stay out of scope; this plan finishes base pricing and tier alignment only.

---

## 11. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Two threshold documents | Block Phase D until question 9.1 is answered |
| Book path bypasses lock | Phase B wires lock before book; integration test |
| Delivery fee mismatch | Phase C single buildQuote path for card, lock, and book |
| Legacy fallback masks engine in demos | Staging seeded with 5 or more provider inputs per demo service |
| Manual migrations not applied | Handoff checklist after each migration file |
| Section 3.4 delete affects live data | Reference-count queries in script; owner runs manually |

---

## 12. What we need from you to start

1. Written approval of this plan (reply email or annotated doc).
2. Answers to section 9, at minimum question 9.1 (tier thresholds) and question 9.5 (area policy).
3. Confirmation that staging Supabase is the environment for first demo.

After that, we implement in phase order B, then C, then D, with E on your schedule.

---

## 13. Document maintenance

- When approved, note approval date and environment at the top of this file or in your project tracker.
- After delivery, update docs/tier-engine.md and the pricing section of docs/m3-client-letter.md if they no longer match production behaviour.
