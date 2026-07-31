# Milestone 3 — Review Response

**Project:** FreshUp
**Date:** 10 May 2026
**To:** Munib
**Subject:** Response to your six review points on the Milestone 3 demo

---

Dear Munib,

Thank you for the detailed feedback on the Milestone 3 demo. Below is a
point-by-point response covering everything you raised. Each point shows
what was done, what is still pending, and what needs your decision.

---

## 1. Cooldown logic — fixed

You raised that providers who had recently been in a dispatch were being
left out of new offers in a way that created an earnings gap. The
cooldown system has been simplified to **two rules** and nothing else.
Both rules are enforced at the database level inside the matching
function, so they apply uniformly to every dispatch.

### Rule 1 — Active job

A provider who currently has a job in any active state
(`assigned`, `en route`, `in progress`) does **not** receive new
requests until either:

- the current job is **completed**, or
- the provider taps the new **"Ready for next request"** button
  described below.

### Rule 2 — Just accepted (5-minute settling window)

For **5 minutes** after any acceptance — whether the accepted job is
immediate or scheduled for later — the provider is **not** offered any
further requests. This gives the provider a short buffer to commit to
the job they just took, especially important for scheduled jobs where
Rule 1's overlap check would not otherwise catch the moment of accept.
The window is currently set to 5 minutes; the spec allows up to 10 and
we can move to 10 with a one-line change if you prefer.

### After completion

There is **no third rule**. Once a job is completed and Rule 2's
5-minute window has passed, the provider is fully back in the dispatch
pool with no soft penalty, no deprioritization, and no other filter.
This closes the post-completion earnings gap you raised.

### "Ready for next request" — new opt-in control

A new button appears on the provider's in-service screen during a job:

> **"Ready for next request"** (Norwegian: _Klar for neste forespørsel_)

When the provider taps it, the system understands that the provider is
free to receive new offers even before the current job is completed
(useful when, for example, a haircut is half done and the next customer
needs travel time). This is fully optional. If the provider does not
tap it, Rule 1 applies — they remain unavailable until the current job
finishes.

---

## 2. Tier score on the dashboard — fixed

You were right that the demo was showing **"Gold tier · score 50"**,
which is internally inconsistent (a score of 50 should never appear with
a Gold label under either of our specifications).

The number 50 was a leftover placeholder in the user interface and was
never connected to the real tier engine. The placeholder has been
removed. The score on the dashboard is now consistent with the displayed
tier:

| Tier | Score shown |
|---|---|
| Gold | 75 |
| Silver | 60 |
| Bronze | 40 |

The tier label itself (Gold / Silver / Bronze) was always coming from
the real tier engine in the database — that part has always been
genuine. The work remaining on this point is to expose the per-provider
percentages (acceptance, completion, response speed) through the
dashboard so that providers see their own real numbers instead of
indicative averages. We are scheduling that for Milestone 4.

---

## 3. Tier engine — written explanation

A complete written explanation of the tier engine has been prepared and
is included with this response. In summary:

**Formula** — score is a weighted combination, not a simple average:

> 35 % acceptance ratio · 35 % completion ratio · 30 % response speed

**Thresholds** — current implementation:

| Tier | Score range |
|---|---|
| Gold | 0.70 and above |
| Silver | 0.42 to 0.70 |
| Bronze | below 0.42 |

The Gold cut-off matches the Pricing & Tier System document. The
Silver / Bronze cut-off is a placeholder pending the threshold decision
described in the next paragraph.

**Pending decision (yours):** the Pricing & Tier System document gives
one set of cut-offs (50 % / 70 %) and the Architecture document gives a
different set (60 % / 80 %). Both cannot be implemented at once. We are
waiting for your confirmation of which set is final, after which the
threshold update is a one-line change.

**New providers** — providers with fewer than three offers and fewer
than two completed jobs default to Gold, so that newcomers and quiet
providers are never penalised for absence of data.

**Window** — performance is measured over the **last 30 days**.

**Recalculation** — the engine recalculates **every hour**.

**Dispatch use** — within each distance / star batch, the system opens
three sub-waves: Gold first, Silver three seconds later, Bronze three
seconds after that. Gold providers are always notified first but never
exclusively.

---

## 4. Pricing logic — confirmed and ready

> **Have you read the Pricing & Tier System document in full?**

Yes — completely. Sections 2.1 through 2.5 (and the tier section in §3)
have all been read end-to-end.

> **Do you have any concerns or questions about the pricing model
> before Milestone 5?**

No structural concerns. Two small points worth flagging:

1. **Trim percentage edge case.** The document says "drop the top and
   bottom 10 %". With small samples (for example exactly five providers),
   the rule rounds down to zero rows trimmed. The current implementation
   treats this as intended — no trimming is done until at least ten
   provider inputs exist. Please confirm this is the desired behaviour,
   or whether you would prefer at least one outlier to be dropped from
   each end regardless of sample size.

2. **Capacity multiplier neutral default.** When an area has zero active
   bookings AND zero providers online, the capacity formula has nothing
   to divide. The implementation defaults to a neutral 50 % capacity
   (multiplier = 0) in this case. This keeps customer-side pricing
   stable on cold starts. Please let us know if you prefer a different
   default.

> **Is there anything in the current Milestone 3 implementation that
> conflicts with the pricing model?**

No. The Milestone 3 customer-facing prices are now produced by the new
pricing engine, not by the older static price ranges. Specifically:

- **§2.1** — Provider base-price submission, area-based grouping
  (10 Norwegian cities), trimmed-mean aggregation, and the 5-provider
  activation threshold are all implemented.
- **§2.2** — The 20 % FreshUp commission is applied by **division**
  (`customer price = provider price ÷ 0.80`), not by multiplying by 1.20.
  The specification is explicit on this and the implementation follows it.
- **§2.3** — The dynamic multiplier in the range −30 % … +30 % is
  computed from current used capacity and refreshes every five minutes,
  not on every booking.
- **§2.3 / price lock** — Customer prices are locked into the booking
  for 15 minutes, so the displayed price is honoured at checkout.
- **§2.4** — Delivery fee is `150 NOK + 10 NOK per kilometre`, with
  100 % paid to the provider.
- **§2.5** — Add-ons use the same 20 % commission split as the main
  service.

**End-to-end verification:** a provider input of 540 NOK in Oslo, with
the area currently at 0 % used capacity (–30 % multiplier), correctly
produces a customer price of **472.50 NOK**. The number on screen
matches the formula precisely.

The practical consequence is that Milestone 5's pricing scope is
largely already in place. The remaining Milestone 5 work is the
campaign / promo layer on top, not the base pricing engine itself.

---

## 5. Dispatch batches and data cleanup

### 5a. Six dispatch batches — confirmed

All six batches are implemented exactly as listed in the Architecture
document, in the following order:

| # | Distance | Minimum rating |
|---|---|---|
| 1 | 0 – 3 km | 5★ |
| 2 | 0 – 3 km | 4★ |
| 3 | 3 – 6 km | 5★ |
| 4 | 3 – 6 km | 4★ |
| 5 | 6 – 10 km | 5★ |
| 6 | 6 – 10 km | 4★ |

Within each batch, the Gold → Silver → Bronze tier waves open with a
three-second gap, exactly as specified.

### 5b. Data cleanup — script ready, manual run required

You correctly identified that some service rows were misplaced or had
unfriendly machine-style names showing through to the customer
interface. The specific items confirmed are:

- A row named **bob** (no category, no base price)
- A row named **air_filter** (orphan, no target category linkage)
- Three duplicate rows of **Skin Fade**, **Low Fade**, and **Mid Fade**

A cleanup script with the exact removal statements has been prepared,
together with safety checks that confirm no other parts of the system
depend on these rows. We will run the cleanup script in the next
maintenance window now that the capacity issue (point 6) is resolved.

The snake_case names you saw in the user interface come from these
same orphan rows. Removing them will make the snake_case names
disappear automatically, with no further code change.

---

## 6. Supabase capacity — root cause and fix

The capacity drain on the project is **not** caused by test data, logs,
or storage. The cause is over-frequent scheduled background jobs.
Specifically, one background job was running every three seconds, plus
two older versions of the same job that had not been retired. Together
these accounted for approximately:

| Job | Frequency | Per day | Per month |
|---|---|---|---|
| Dispatch tick (current) | every 3 seconds | ~28,800 | **~864,000** |
| Dispatch tick (legacy) | every 15 seconds | ~5,760 | ~172,800 |
| Dispatch tick (legacy) | every minute | 1,440 | ~43,200 |

**Total: roughly 1.1 million invocations per month**, dominated almost
entirely by the three-second tick.

A migration has been **applied** to the project that:

1. Reschedules the dispatch tick from **every 3 seconds** to **every 60
   seconds**, dropping the dispatch invocations by approximately 95 %.
2. Removes the two older duplicate dispatch jobs that were no longer
   needed.
3. Leaves the other low-frequency jobs (cancel-stale-orders, hourly
   tier refresh) untouched.

**Expected impact:** monthly invocations from approximately 1.1 million
down to approximately 45,000 — comfortably within the project's
free-tier budget. The new schedule is now live and the legacy duplicate
jobs have been retired.

---

## Process change — implementation plan template

Agreed and adopted from Milestone 4 onward. Before writing any code on
Milestones 4, 5, or 6, we will send a short implementation plan
covering: which sections of the specification are being read, which
files / surfaces will be touched, the assumptions being made, and any
edge cases identified. No code will ship for those milestones until the
plan is approved.

---

## Summary table

| Point | Status |
|---|---|
| 1 — Cooldown logic (two-rule policy) | **Fixed and live** |
| 1 — "Ready for next request" button | **Implemented and live** |
| 2 — Tier score inconsistency | **Fixed** |
| 3 — Tier engine written explanation | **Delivered** |
| 4 — Pricing readiness for Milestone 5 | **Confirmed** |
| 5a — Six dispatch batches | **Verified, already correct** |
| 5b — Data cleanup script | **Ready, scheduled for next maintenance window** |
| 6 — Supabase capacity migration | **Applied and live** |
| Process — Implementation plan template | **Adopted from M4 onward** |

---

## Two items remaining on your side

1. **Tier threshold reconciliation.** Please confirm whether the final
   thresholds are the Pricing & Tier System set (Gold ≥ 70 %,
   Silver 50 – 70 %, Bronze < 50 %) or the Architecture document set
   (Gold ≥ 80 %, Silver 60 – 80 %, Bronze < 60 %). The change is a
   one-line update once you confirm.

2. **Approval of the Milestone 4 implementation plan.** A short plan
   document will follow this response separately, for your sign-off
   before any code is written.

---

We are happy to walk through any of these points in detail on a call,
or to demonstrate them live in the application.

Best regards,
**FreshUp Development Team**
