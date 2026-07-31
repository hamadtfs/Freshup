"use client";

import { useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";

const COPY = {
  en: {
    title: "Add new card",
    save: "Save card",
    saving: "Saving…",
    cancel: "Cancel",
    submitError: "Could not submit the form",
    saveFailed: "Could not save card",
    keysMissing: "Stripe is not configured.",
  },
  no: {
    title: "Legg til nytt kort",
    save: "Lagre kort",
    saving: "Lagrer…",
    cancel: "Avbryt",
    submitError: "Kunne ikke sende skjema",
    saveFailed: "Kunne ikke lagre kort",
    keysMissing: "Stripe er ikke konfigurert.",
  },
} as const;

function InnerAddCard({
  setupIntentId,
  onSuccess,
  onCancel,
  language,
  accessToken,
}: {
  setupIntentId: string;
  onSuccess: () => void;
  onCancel: () => void;
  language: "no" | "en";
  accessToken: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = COPY[language === "en" ? "en" : "no"];

  const handleSave = async () => {
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);

    const submitResult = await elements.submit();
    if (submitResult.error) {
      setError(submitResult.error.message ?? t.submitError);
      setSubmitting(false);
      return;
    }

    const result = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
    });
    if (result.error) {
      setError(result.error.message ?? t.saveFailed);
      setSubmitting(false);
      return;
    }

    const intentId = result.setupIntent?.id || setupIntentId;
    const confirmRes = await fetch("/api/payments/methods", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ setup_intent_id: intentId }),
    });
    const confirmData = await confirmRes.json().catch(() => ({}));
    if (!confirmRes.ok) {
      setError(String(confirmData?.error || t.saveFailed));
      setSubmitting(false);
      return;
    }

    onSuccess();
  };

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-foreground">{t.title}</p>
      <PaymentElement />
      {error && <div className="text-xs text-destructive">{error}</div>}
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1 h-11 rounded-lg bg-transparent"
          onClick={onCancel}
          disabled={submitting}
        >
          {t.cancel}
        </Button>
        <Button
          className="flex-1 h-11 rounded-lg"
          onClick={() => void handleSave()}
          disabled={submitting || !stripe || !elements}
        >
          {submitting ? t.saving : t.save}
        </Button>
      </div>
    </div>
  );
}

export default function AddCardForm({
  clientSecret,
  setupIntentId,
  accessToken,
  onSuccess,
  onCancel,
  language = "no",
}: {
  clientSecret: string;
  setupIntentId: string;
  accessToken: string;
  onSuccess: () => void;
  onCancel: () => void;
  language?: "no" | "en";
}) {
  const stripePromise = useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [],
  );
  const stripeLocale = language === "en" ? "en" : "nb";
  const t = COPY[language === "en" ? "en" : "no"];
  const options = useMemo(
    () => ({
      clientSecret,
      locale: stripeLocale,
      appearance: {
        theme: "flat" as const,
        variables: { colorPrimary: "#111827", borderRadius: "12px" },
      },
    }),
    [clientSecret, stripeLocale],
  );

  if (!publishableKey || !stripePromise) {
    return <div className="text-sm text-muted-foreground">{t.keysMissing}</div>;
  }

  return (
    <Elements
      stripe={stripePromise}
      options={options}
      key={`${clientSecret}-${stripeLocale}`}
    >
      <InnerAddCard
        setupIntentId={setupIntentId}
        onSuccess={onSuccess}
        onCancel={onCancel}
        language={language}
        accessToken={accessToken}
      />
    </Elements>
  );
}
