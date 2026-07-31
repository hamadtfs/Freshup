"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { loadStripe, type Stripe } from "@stripe/stripe-js"
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js"
import { CreditCard, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { createBrowserSupabaseClient } from "@/lib/supabase/client"
import {
  formatDisplayUsdFromKr,
  roundDisplayKr,
} from "@/lib/pricing/format-display-kr"

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || ""

type SavedMethod = {
  id: string
  label: string
  is_default: boolean
  stripe_payment_method_id: string | null
}

const COPY = {
  en: {
    submitError: "Could not submit the form",
    paymentFailed: "Payment failed",
    confirm: "Confirm payment",
    confirming: "Confirming…",
    cancel: "Cancel",
    testTip:
      "Tip: Use test card 4242 4242 4242 4242, any future expiry date, and any CVC.",
    title: "Payment",
    keysMissing:
      "Stripe keys are missing. Set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY (browser) and STRIPE_SECRET_KEY (server only).",
    continueWithout: "Continue without payment",
    reserved: (displayAmount: string) =>
      `Up to ${displayAmount} will be reserved on your card.`,
    deliveryNote: (displayCeiling: string) =>
      `Includes up to ${displayCeiling} for delivery. The exact amount is charged once a provider is matched.`,
    savedCards: "Saved cards",
    useDifferentCard: "Use a different card",
    useSavedCard: "Use a saved card",
    loadingCards: "Loading saved cards…",
    noSavedCards: "No saved cards yet — enter card details below.",
  },
  no: {
    submitError: "Kunne ikke sende skjema",
    paymentFailed: "Betalingen mislyktes",
    confirm: "Bekreft betaling",
    confirming: "Bekrefter…",
    cancel: "Avbryt",
    testTip:
      "Tips: Bruk testkort 4242 4242 4242 4242, en fremtidig utløpsdato og valgfri CVC.",
    title: "Betaling",
    keysMissing:
      "Stripe-nøkler mangler. Sett NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY (nettleser) og STRIPE_SECRET_KEY (kun server).",
    continueWithout: "Fortsett uten betaling",
    reserved: (displayAmount: string) =>
      `Opptil ${displayAmount} reserveres på kortet ditt.`,
    deliveryNote: (displayCeiling: string) =>
      `Inkluderer opptil ${displayCeiling} for Delivery. Nøyaktig beløp belastes når en tilbyder er matchet.`,
    savedCards: "Lagrede kort",
    useDifferentCard: "Bruk et annet kort",
    useSavedCard: "Bruk lagret kort",
    loadingCards: "Henter lagrede kort…",
    noSavedCards: "Ingen lagrede kort ennå — fyll inn kortdetaljer under.",
  },
} as const

function AmountNote({
  amount,
  currency,
  deliveryCeilingKr,
  isHomeDelivery,
  language,
}: {
  amount: number
  currency: string
  deliveryCeilingKr?: number
  isHomeDelivery?: boolean
  language?: "no" | "en"
}) {
  const t = COPY[language === "en" ? "en" : "no"]
  const isEn = language === "en"
  const reservedLabel = isEn
    ? formatDisplayUsdFromKr(amount)
    : `${roundDisplayKr(amount)} ${currency.toUpperCase()}`
  return (
    <div className="text-xs text-muted-foreground space-y-1">
      <div>{t.reserved(reservedLabel)}</div>
      {isHomeDelivery && deliveryCeilingKr != null && deliveryCeilingKr > 0 && (
        <div>
          {t.deliveryNote(
            isEn
              ? formatDisplayUsdFromKr(deliveryCeilingKr)
              : `${roundDisplayKr(deliveryCeilingKr)} kr`,
          )}
        </div>
      )}
    </div>
  )
}

function InnerPayment({
  onSuccess,
  onCancel,
  amount,
  currency,
  deliveryCeilingKr,
  isHomeDelivery = false,
  language = "no",
}: {
  onSuccess: () => void
  onCancel: () => void
  amount: number
  currency: string
  deliveryCeilingKr?: number
  isHomeDelivery?: boolean
  language?: "no" | "en"
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = COPY[language === "en" ? "en" : "no"]

  const handleConfirm = async () => {
    if (!stripe || !elements) return
    setSubmitting(true)
    setError(null)
    const submitResult = await elements.submit()
    if (submitResult.error) {
      setError(submitResult.error.message ?? t.submitError)
      setSubmitting(false)
      return
    }
    const result = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    })
    if (result.error) {
      setError(result.error.message ?? t.paymentFailed)
      setSubmitting(false)
      return
    }
    onSuccess()
  }

  return (
    <div className="space-y-3">
      <PaymentElement />
      <AmountNote
        amount={amount}
        currency={currency}
        deliveryCeilingKr={deliveryCeilingKr}
        isHomeDelivery={isHomeDelivery}
        language={language}
      />
      {error && <div className="text-xs text-destructive">{error}</div>}
      <div className="flex gap-2 pt-1">
        <Button className="flex-1" onClick={handleConfirm} disabled={submitting || !stripe || !elements}>
          {submitting ? t.confirming : t.confirm}
        </Button>
        <Button variant="outline" className="flex-1 bg-transparent" onClick={onCancel} disabled={submitting}>
          {t.cancel}
        </Button>
      </div>
      <div className="text-[11px] text-muted-foreground">{t.testTip}</div>
    </div>
  )
}

function SavedCardPayment({
  stripePromise,
  clientSecret,
  methods,
  selectedMethodId,
  onSelectMethod,
  onUseNewCard,
  onSuccess,
  onCancel,
  amount,
  currency,
  deliveryCeilingKr,
  isHomeDelivery,
  language,
}: {
  stripePromise: Promise<Stripe | null>
  clientSecret: string
  methods: SavedMethod[]
  selectedMethodId: string
  onSelectMethod: (id: string) => void
  onUseNewCard: () => void
  onSuccess: () => void
  onCancel: () => void
  amount: number
  currency: string
  deliveryCeilingKr?: number
  isHomeDelivery?: boolean
  language?: "no" | "en"
}) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = COPY[language === "en" ? "en" : "no"]

  const selected = methods.find((m) => m.id === selectedMethodId) ?? methods[0]

  const handleConfirm = async () => {
    const stripePmId = String(selected?.stripe_payment_method_id || "").trim()
    if (!stripePmId) {
      setError(t.paymentFailed)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const stripe = await stripePromise
      if (!stripe) {
        setError(t.paymentFailed)
        setSubmitting(false)
        return
      }
      const result = await stripe.confirmCardPayment(clientSecret, {
        payment_method: stripePmId,
      })
      if (result.error) {
        setError(result.error.message ?? t.paymentFailed)
        setSubmitting(false)
        return
      }
      onSuccess()
    } catch {
      setError(t.paymentFailed)
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-gray-800">{t.savedCards}</p>
      <div className="space-y-2">
        {methods.map((method) => {
          const selectedCard = method.id === selectedMethodId
          return (
            <button
              key={method.id}
              type="button"
              onClick={() => onSelectMethod(method.id)}
              className={`w-full rounded-xl border p-3 text-left transition-colors ${
                selectedCard
                  ? "border-green-500 bg-green-50/80"
                  : "border-gray-200 bg-white hover:border-gray-300"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
                  <CreditCard className="h-5 w-5 text-gray-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-gray-900">{method.label}</p>
                  {method.is_default && (
                    <p className="text-xs font-medium text-green-600">
                      {language === "en" ? "Default" : "Standard"}
                    </p>
                  )}
                </div>
                <div
                  className={`h-4 w-4 rounded-full border-2 ${
                    selectedCard ? "border-green-600 bg-green-600" : "border-gray-300"
                  }`}
                />
              </div>
            </button>
          )
        })}
      </div>
      <button
        type="button"
        onClick={onUseNewCard}
        className="text-sm font-medium text-gray-600 underline-offset-2 hover:underline"
      >
        {t.useDifferentCard}
      </button>
      <AmountNote
        amount={amount}
        currency={currency}
        deliveryCeilingKr={deliveryCeilingKr}
        isHomeDelivery={isHomeDelivery}
        language={language}
      />
      {error && <div className="text-xs text-destructive">{error}</div>}
      <div className="flex gap-2 pt-1">
        <Button className="flex-1" onClick={() => void handleConfirm()} disabled={submitting || !selected}>
          {submitting ? t.confirming : t.confirm}
        </Button>
        <Button variant="outline" className="flex-1 bg-transparent" onClick={onCancel} disabled={submitting}>
          {t.cancel}
        </Button>
      </div>
    </div>
  )
}

export default function PaymentStep({
  clientSecret,
  onSuccess,
  onCancel,
  amount,
  currency = "nok",
  deliveryCeilingKr,
  isHomeDelivery = false,
  language = "no",
}: {
  clientSecret: string
  onSuccess: () => void
  onCancel: () => void
  amount: number
  currency?: string
  deliveryCeilingKr?: number
  isHomeDelivery?: boolean
  language?: "no" | "en"
}) {
  const stripePromise = useMemo(() => (publishableKey ? loadStripe(publishableKey) : null), [])
  const t = COPY[language === "en" ? "en" : "no"]
  const stripeLocale = language === "en" ? "en" : "nb"
  const options = useMemo(
    () => ({
      clientSecret,
      locale: stripeLocale,
      appearance: {
        theme: "flat",
        variables: { colorPrimary: "#111827", borderRadius: "12px" },
      },
    }),
    [clientSecret, stripeLocale],
  )

  const [savedMethods, setSavedMethods] = useState<SavedMethod[]>([])
  const [loadingMethods, setLoadingMethods] = useState(true)
  const [selectedMethodId, setSelectedMethodId] = useState<string | null>(null)
  const [useNewCard, setUseNewCard] = useState(false)

  const loadSavedMethods = useCallback(async () => {
    setLoadingMethods(true)
    try {
      const supabase = createBrowserSupabaseClient() as {
        auth: {
          getSession: () => Promise<{
            data: { session?: { access_token?: string } | null }
          }>
        }
      }
      const { data } = await supabase.auth.getSession()
      const token = data?.session?.access_token
      if (!token) {
        setSavedMethods([])
        setUseNewCard(true)
        return
      }
      const res = await fetch("/api/payments/methods", {
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSavedMethods([])
        setUseNewCard(true)
        return
      }
      const rows = (Array.isArray(body.methods) ? body.methods : []) as Array<{
        id: string
        label: string
        is_default: boolean
        stripe_payment_method_id?: string | null
      }>
      const usable = rows
        .filter((m) => String(m.stripe_payment_method_id || "").trim())
        .map((m) => ({
          id: m.id,
          label: m.label,
          is_default: m.is_default,
          stripe_payment_method_id: m.stripe_payment_method_id ?? null,
        }))
      setSavedMethods(usable)
      const defaultMethod = usable.find((m) => m.is_default) ?? usable[0] ?? null
      setSelectedMethodId(defaultMethod?.id ?? null)
      setUseNewCard(usable.length === 0)
    } finally {
      setLoadingMethods(false)
    }
  }, [])

  useEffect(() => {
    void loadSavedMethods()
  }, [loadSavedMethods])

  if (!publishableKey || !stripePromise) {
    return (
      <div className="space-y-3">
        <div className="text-sm font-medium">{t.title}</div>
        <div className="text-sm text-muted-foreground">{t.keysMissing}</div>
        <div className="flex gap-2">
          <Button className="flex-1" onClick={onSuccess}>
            {t.continueWithout}
          </Button>
          <Button variant="outline" className="flex-1 bg-transparent" onClick={onCancel}>
            {t.cancel}
          </Button>
        </div>
      </div>
    )
  }

  if (loadingMethods) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t.loadingCards}
      </div>
    )
  }

  if (!useNewCard && savedMethods.length > 0 && selectedMethodId) {
    return (
      <SavedCardPayment
        stripePromise={stripePromise}
        clientSecret={clientSecret}
        methods={savedMethods}
        selectedMethodId={selectedMethodId}
        onSelectMethod={setSelectedMethodId}
        onUseNewCard={() => setUseNewCard(true)}
        onSuccess={onSuccess}
        onCancel={onCancel}
        amount={amount}
        currency={currency}
        deliveryCeilingKr={deliveryCeilingKr}
        isHomeDelivery={isHomeDelivery}
        language={language}
      />
    )
  }

  return (
    <div className="space-y-3">
      {savedMethods.length > 0 && (
        <button
          type="button"
          onClick={() => {
            setUseNewCard(false)
            if (!selectedMethodId && savedMethods[0]) {
              setSelectedMethodId(savedMethods[0].id)
            }
          }}
          className="text-sm font-medium text-gray-600 underline-offset-2 hover:underline"
        >
          {t.useSavedCard}
        </button>
      )}
      {savedMethods.length === 0 && (
        <p className="text-xs text-muted-foreground">{t.noSavedCards}</p>
      )}
      <Elements stripe={stripePromise} options={options as any} key={`${clientSecret}-${stripeLocale}-new`}>
        <InnerPayment
          onSuccess={onSuccess}
          onCancel={onCancel}
          amount={amount}
          currency={currency}
          deliveryCeilingKr={deliveryCeilingKr}
          isHomeDelivery={isHomeDelivery}
          language={language}
        />
      </Elements>
    </div>
  )
}
