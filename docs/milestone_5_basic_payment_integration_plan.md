# Milestone 5 — Basic payment integration

This document is the **implementation plan and status** for enabling payments in FreshUp: booking authorization/capture, saved cards, transaction history, order lists, and provider earnings.

It builds on **Milestone 4** (job lifecycle, realtime) and the **Milestone 3** pricing/dispatch stack.

---

## 1. Goals and deliverables

**Goal:** Enable payments end-to-end for customers and providers.

**Deliverables**

| Deliverable | Status |
|-------------|--------|
| Customer can complete a payment (authorize at confirm, capture at match) | Done |
| Customer can see payment history and manage cards | Done |
| Customer can see order history and upcoming bookings | Done |
| Provider can see earnings reports (day / week / month) | Done |
| Provider can see jobs history and upcoming jobs | Done |

---

## 2. Scope

### 2.1 Payment method integration

| Item | Implementation |
|------|----------------|
| Stripe PaymentIntent (manual capture) | `lib/payments/order-payment.ts`, `POST /api/payments/prepare-booking`, `POST /api/payments/authorize` |
| Confirm payment at booking | `components/payment-step.tsx` + portal overlay in `app/page.tsx` |
| Success / failure handling | `handleBookingPaymentSuccess` in `app/page.tsx`; release on abort/timeout via `releaseOrderPayment` |
| Saved cards (SetupIntent) | `POST /api/payments/methods/setup-intent`, `POST /api/payments/methods`, `components/add-card-form.tsx` |
| Remove card / set default | `DELETE` / `PATCH /api/payments/methods/[id]` |

### 2.2 Customer features

| Page | Route | Implementation |
|------|-------|----------------|
| Payment — add / remove card, history | `/payment` | `components/payment-page.tsx`, `GET /api/payments/history` |
| Orders — upcoming / completed | `/orders` | `components/orders-page.tsx`, `GET /api/orders/list` |

### 2.3 Provider features

| Page | Route | Implementation |
|------|-------|----------------|
| Earnings — D/W/M filters, recent tx | `/earnings` | `components/earnings-page.tsx`, `GET /api/provider/earnings` |
| My jobs — upcoming / completed | `/orders` (provider mode) | Same `OrdersPage` with `userType="provider"` |

---

## 3. Payment flows

### 3.1 Booking authorize → capture

```
Confirm booking
  → POST /api/payments/prepare-booking (manual-capture PI)
  → Customer confirms in PaymentElement overlay
  → POST /api/payments/authorize (mark lock authorized)
  → POST /api/orders/book
Provider accepts
  → captureOrderPaymentAtMatch (exact amount, ≤ authorized)
No match / abort / timeout
  → releaseOrderPayment (cancel PI)
```

**Authorize amount (home delivery):** service + add-ons + `maxDeliveryFeeAtDispatchRadius()` (250 kr at 10 km dispatch radius).

### 3.2 Saved cards

```
Payment page → Add card
  → POST /api/payments/methods/setup-intent
  → Stripe PaymentElement (SetupIntent)
  → POST /api/payments/methods { setup_intent_id }
  → Row in payment_methods + Stripe Customer on customer_details
```

---

## 4. Data model

| Table / column | Purpose |
|----------------|---------|
| `booking_price_locks.stripe_payment_intent_id` | Booking payment PI |
| `booking_price_locks.payment_*` | Authorized/captured amounts and timestamps |
| `customer_details.stripe_customer_id` | Stripe Customer for saved cards |
| `payment_methods` | Local mirror of saved Stripe cards |
| `orders` + `booking_price_locks` | Earnings and order list pricing |

**Migration (manual apply):** `supabase/migrations/20260624140000_booking_payment_auth.sql`

---

## 5. Environment

| Variable | Where |
|----------|--------|
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Browser (Elements) |
| `STRIPE_SECRET_KEY` | Server only — never `NEXT_PUBLIC_*` |

---

## 6. Key files

| Area | Files |
|------|--------|
| Core payment | `lib/payments/order-payment.ts`, `payment-amounts.ts`, `delivery-ceiling.ts`, `stripe.ts` |
| Saved cards | `lib/payments/stripe-customer.ts`, `payment-methods.ts` |
| APIs | `app/api/payments/*`, `app/api/orders/list`, `app/api/provider/earnings` |
| UI | `components/payment-page.tsx`, `payment-step.tsx`, `add-card-form.tsx`, `orders-page.tsx`, `earnings-page.tsx` |
| Booking UI | `app/page.tsx` (payment portal overlay) |

---

## 7. Test plan

1. Set Stripe test keys; restart dev server.
2. Apply `20260624140000_booking_payment_auth.sql` if not applied.
3. **Booking:** confirm → payment sheet (full header visible) → card `4242…` → hunt → provider accept → status shows charged amount.
4. **Payment page:** add card, set default, remove card.
5. **History:** authorized/captured rows appear after booking.
6. **Orders:** upcoming vs completed tabs (customer and provider).
7. **Earnings:** D/W/M totals and transaction list for completed jobs.

---

## 8. Non-goals (defer)

- **Apple Pay** — not live. Domain registration + remaining work: `docs/apple-pay-outstanding.md`.
- Vipps production integration.
- Provider payouts / Stripe Connect transfers.
- Refunds UI and dispute workflow.
- PCI beyond Stripe Elements (no raw card fields in app code).
