# Apple Pay — outstanding (do this when leaving the temporary deploy)

Web Apple Pay will not appear until the **live domain** is registered with Stripe/Apple. Domain verification is **web-only**. The native app is a separate track and will still not show Apple Pay after the domain is verified.

Stripe docs: [Apple Pay (web)](https://docs.stripe.com/apple-pay?platform=web) · [Payment method domains](https://dashboard.stripe.com/settings/payment_method_domains)

---

## Why it is missing today

| Surface | What the user sees | Why |
|---------|-------------------|-----|
| Web booking (Safari) | Apple Pay toggle exists, then `canMakePayment()` fails | Domain is not registered; Stripe returns no Apple Pay |
| Web Payment Element | No Apple Pay wallet button | Same domain registration; Elements only show Apple Pay on a verified domain, Safari, and a device with Wallet |
| Native iOS app | Confirm sheet is hardcoded **Card** | No Stripe React Native Apple Pay, no merchant ID / entitlement |

Stripe will not show Apple Pay unless: HTTPS, Safari (iOS 10+ / macOS Sierra+), a card in Apple Wallet, **and** the exact hostname registered.

---

## When we move off the temporary deploy (web)

Do these on the **final** hostname (e.g. `freshup.app`). Preview/Vercel URLs do not carry over.

1. **Register the domain in Stripe (live and test if both are used)**  
   Dashboard → [Payment method domains](https://dashboard.stripe.com/settings/payment_method_domains) → add:
   - apex: `freshup.app`
   - `www.freshup.app` if that host also serves the app  
   Stripe registers the domain with Apple. Do **not** create an Apple Merchant ID / CSR for web — Stripe does that.

2. **Keep Apple’s verification file reachable**  
   Apple fetches  
   `https://<host>/.well-known/apple-developer-merchantid-domain-association`  
   Must be **HTTPS, HTTP 200, no redirect** (www → apex or the reverse breaks verification).  
   This repo has **no** `public/.well-known/` file yet. After Stripe registration, host the association file Stripe gives you (or confirm Stripe’s verification succeeded).  
   `middleware.ts` currently matches almost every path; exclude `/.well-known/*` from rewrites/auth when that file is added.

3. **Safari only for web**  
   Chrome / Firefox on Mac will not show Apple Pay. Test on Safari + a real Wallet card. Stripe test cards cannot be saved to Wallet; Stripe accepts a live card in test mode and does not charge it.

4. **Register every host that shows the button**  
   Production, `www`, and any extra subdomain (staging) each need their own domain row.

5. **Connect (only if we use direct charges)**  
   Platform domain registration is not enough for connected-account **direct** charges. Destination/separate charges on the platform account are fine with the platform domain. Confirm charge type before launch.

---

## Code that will still block Apple Pay after the domain is live

These are independent of hosting and should be fixed in the same cutover.

1. **Lost user gesture (web)** — `confirmBookingWithApplePay` in `lib/payments/booking-payment-client.ts`  
   Apple requires `paymentRequest.show()` in the same tap handler, **before** awaits. Today we `await` session + `prepare-booking` first, then show the sheet. That often makes Apple Pay fail even on a verified domain. Prepare the PaymentIntent earlier, or show the sheet immediately on tap.

2. **Native iOS is not implemented**  
   - Confirm sheet always says Card (`mobile-app/components/booking/ConfirmSheet.tsx`)  
   - Booking uses a saved card + WebView 3DS (`BookingPaymentWebAuth`)  
   - No `@stripe/stripe-react-native`  
   - No Apple Pay capability / `com.apple.developer.in-app-payments`  
   - No merchant identifier (bundle is `app.freshup.app` → typically `merchant.app.freshup`)  
   Native Apple Pay does **not** use the web domain file. It needs an Apple Developer merchant ID, the Stripe `merchantIdentifier`, and a native payment sheet.

3. **PaymentIntents are card-only** — `payment_method_types: ["card"]` in `lib/payments/order-payment.ts`  
   That is OK for Apple Pay (Wallet tokens are card PMs). No change required unless we switch to `automatic_payment_methods`.

---

## Cutover checklist

- [ ] Production host on HTTPS (apex and www if used)
- [ ] Domain(s) added in Stripe Payment method domains (test + live)
- [ ] `/.well-known/apple-developer-merchantid-domain-association` returns 200, no redirect
- [ ] `middleware.ts` does not rewrite or challenge `.well-known`
- [ ] Web: Apple Pay sheet shown from the tap (no await before `show()`)
- [ ] Verified in Safari on a device with Wallet
- [ ] Native (separate): merchant ID, entitlement, Stripe RN Platform Pay, Confirm sheet option
