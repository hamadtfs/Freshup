import { loadStripe } from "@stripe/stripe-js";
import { bookingPaymentUserMessage } from "@/lib/payments/booking-payment-errors";

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";

async function getStripe() {
  if (!publishableKey) {
    throw new Error("STRIPE_NOT_CONFIGURED");
  }
  const stripe = await loadStripe(publishableKey);
  if (!stripe) {
    throw new Error("STRIPE_LOAD_FAILED");
  }
  return stripe;
}

export async function fetchDefaultStripePaymentMethodId(
  accessToken: string,
): Promise<string | null> {
  const res = await fetch("/api/payments/methods", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return null;

  const methods = (
    Array.isArray(body.methods) ? body.methods : []
  ) as Array<{
    stripe_payment_method_id?: string | null;
    is_default?: boolean;
  }>;

  const usable = methods
    .map((m) => String(m.stripe_payment_method_id || "").trim())
    .filter(Boolean);

  if (usable.length === 0) return null;

  const defaultRow = methods.find(
    (m) => m.is_default && String(m.stripe_payment_method_id || "").trim(),
  );
  if (defaultRow?.stripe_payment_method_id) {
    return String(defaultRow.stripe_payment_method_id).trim();
  }

  return usable[0] ?? null;
}

export async function prepareBookingPaymentClient(
  accessToken: string,
  priceLockId: string,
): Promise<{ clientSecret: string; authorizeAmountKr: number }> {
  const prepRes = await fetch("/api/payments/prepare-booking", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ price_lock_id: priceLockId }),
  });
  const prepData = await prepRes.json().catch(() => ({}));
  if (!prepRes.ok) {
    throw new Error(String(prepData?.error || "Could not prepare payment"));
  }

  const clientSecret = String(prepData?.client_secret || "").trim();
  if (!clientSecret) {
    throw new Error("Could not start card authorization");
  }

  return {
    clientSecret,
    authorizeAmountKr: Number(prepData?.authorize_amount_kr) || 0,
  };
}

export async function confirmBookingWithSavedCard(
  clientSecret: string,
  paymentMethodId: string,
): Promise<void> {
  const stripe = await getStripe();
  const result = await stripe.confirmCardPayment(clientSecret, {
    payment_method: paymentMethodId,
  });
  if (result.error) {
    throw new Error(
      bookingPaymentUserMessage(result.error.message ?? "Payment failed", true),
    );
  }
}

export async function confirmBookingWithApplePay(
  clientSecret: string,
  amountKr: number,
  serviceLabel: string,
): Promise<void> {
  const stripe = await getStripe();

  return new Promise((resolve, reject) => {
    const paymentRequest = stripe.paymentRequest({
      country: "NO",
      currency: "nok",
      total: {
        label: serviceLabel.slice(0, 40) || "FreshUp",
        amount: Math.round(amountKr * 100),
      },
      requestPayerName: true,
    });

    void paymentRequest.canMakePayment().then((canMake) => {
      if (!canMake?.applePay) {
        reject(new Error("APPLE_PAY_UNAVAILABLE"));
        return;
      }

      paymentRequest.on("paymentmethod", (event) => {
        void stripe
          .confirmCardPayment(
            clientSecret,
            { payment_method: event.paymentMethod.id },
            { handleActions: false },
          )
          .then(({ error }) => {
            if (error) {
              event.complete("fail");
              reject(new Error(error.message ?? "Payment failed"));
              return;
            }
            event.complete("success");
            resolve();
          })
          .catch((err: unknown) => {
            event.complete("fail");
            reject(
              err instanceof Error ? err : new Error("Payment failed"),
            );
          });
      });

      paymentRequest.show().catch((err: unknown) => {
        reject(err instanceof Error ? err : new Error("Payment cancelled"));
      });
    });
  });
}

export async function markBookingPaymentAuthorizedClient(
  accessToken: string,
  priceLockId: string,
): Promise<void> {
  const authRes = await fetch("/api/payments/authorize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ price_lock_id: priceLockId }),
  });
  const authData = await authRes.json().catch(() => ({}));
  if (!authRes.ok) {
    throw new Error(String(authData?.error || "Payment authorization failed"));
  }
}

export async function runBookingPaymentFlow(opts: {
  accessToken: string;
  priceLockId: string;
  paymentMethod: "card" | "apple_pay";
  serviceLabel: string;
  noCardMessage: string;
  applePayUnavailableMessage: string;
}): Promise<void> {
  const { clientSecret, authorizeAmountKr } =
    await prepareBookingPaymentClient(opts.accessToken, opts.priceLockId);

  if (opts.paymentMethod === "apple_pay") {
    try {
      await confirmBookingWithApplePay(
        clientSecret,
        authorizeAmountKr,
        opts.serviceLabel,
      );
    } catch (err) {
      if (err instanceof Error && err.message === "APPLE_PAY_UNAVAILABLE") {
        throw new Error(opts.applePayUnavailableMessage);
      }
      throw err;
    }
  } else {
    const paymentMethodId = await fetchDefaultStripePaymentMethodId(
      opts.accessToken,
    );
    if (!paymentMethodId) {
      throw new Error(opts.noCardMessage);
    }
    await confirmBookingWithSavedCard(clientSecret, paymentMethodId);
  }

  await markBookingPaymentAuthorizedClient(opts.accessToken, opts.priceLockId);
}
