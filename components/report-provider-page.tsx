"use client"

import { useMemo, useState } from "react"
import { ChevronLeft, Flag } from "lucide-react"
import { createBrowserSupabaseClient } from "@/lib/supabase/client"
import {
  PROVIDER_REPORT_CATEGORIES,
  providerReportCategoryLabel,
  type ProviderReportCategory,
} from "@/lib/reports/categories"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type ReportProviderContext = {
  orderId: string
  providerId?: string | null
  providerName?: string | null
  serviceName?: string | null
}

interface ReportProviderPageProps {
  onBack: () => void
  language?: "no" | "en"
  context: ReportProviderContext
  onSubmitted?: () => void
}

export default function ReportProviderPage({
  onBack,
  language = "no",
  context,
  onSubmitted,
}: ReportProviderPageProps) {
  const isEn = language === "en"
  const [category, setCategory] = useState<ProviderReportCategory | null>(null)
  const [description, setDescription] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const canSubmit =
    !!category && description.trim().length >= 10 && !submitting

  const titleParts = useMemo(() => {
    const name = context.providerName?.trim()
    const service = context.serviceName?.trim()
    return { name, service }
  }, [context.providerName, context.serviceName])

  const handleSubmit = async () => {
    if (!category) return
    setError(null)
    setSubmitting(true)
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
        setError(isEn ? "Please sign in again." : "Logg inn på nytt.")
        return
      }

      const res = await fetch("/api/reports/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          order_id: context.orderId,
          provider_id: context.providerId || undefined,
          category,
          description: description.trim(),
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
      }
      if (!res.ok) {
        setError(
          typeof json.error === "string"
            ? json.error
            : isEn
              ? "Could not submit report."
              : "Kunne ikke sende rapport.",
        )
        return
      }
      setDone(true)
      onSubmitted?.()
    } catch {
      setError(
        isEn ? "Could not submit report." : "Kunne ikke sende rapport.",
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto h-[100dvh] w-full max-w-md bg-background flex flex-col">
      <div className="flex items-center justify-between px-4 pt-14 pb-4 border-b border-border">
        <button
          type="button"
          onClick={onBack}
          className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center"
        >
          <ChevronLeft className="h-5 w-5 text-muted-foreground" />
        </button>
        <h1 className="text-base font-semibold text-foreground">
          {isEn ? "Report provider" : "Rapporter tilbyder"}
        </h1>
        <div className="w-10" />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 pb-8">
        {done ? (
          <div className="flex flex-col items-center justify-center min-h-[50vh] text-center px-4">
            <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
              <Flag className="h-6 w-6 text-foreground" />
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-2">
              {isEn ? "Report submitted" : "Rapport sendt"}
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              {isEn
                ? "Thanks. Our team will review this and follow up if needed."
                : "Takk. Teamet vårt vil gå gjennom saken og følge opp ved behov."}
            </p>
            <Button
              type="button"
              className="w-full h-11 rounded-xl"
              onClick={onBack}
            >
              {isEn ? "Done" : "Ferdig"}
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <p className="text-sm text-muted-foreground">
                {isEn
                  ? "Tell us what happened. Reports are confidential."
                  : "Fortell oss hva som skjedde. Rapporter er konfidensielle."}
              </p>
              {(titleParts.name || titleParts.service) && (
                <p className="mt-2 text-sm font-medium text-foreground">
                  {[titleParts.service, titleParts.name]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </div>

            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              {isEn ? "Reason" : "Årsak"}
            </p>
            <div className="space-y-2 mb-6">
              {PROVIDER_REPORT_CATEGORIES.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setCategory(id)}
                  className={cn(
                    "w-full text-left px-4 py-3 rounded-xl border transition-colors",
                    category === id
                      ? "border-foreground bg-muted"
                      : "border-border hover:bg-muted/50",
                  )}
                >
                  <span className="text-sm font-medium text-foreground">
                    {providerReportCategoryLabel(id, language)}
                  </span>
                </button>
              ))}
            </div>

            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">
              {isEn ? "Description" : "Beskrivelse"}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 2000))}
              rows={5}
              placeholder={
                isEn
                  ? "Describe what happened (min. 10 characters)"
                  : "Beskriv hva som skjedde (min. 10 tegn)"
              }
              className="w-full rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-foreground outline-none focus:border-foreground resize-none mb-2"
            />
            <p className="text-xs text-muted-foreground mb-4">
              {description.trim().length}/2000
            </p>

            {error ? (
              <p className="text-sm text-red-600 mb-4">{error}</p>
            ) : null}

            <Button
              type="button"
              disabled={!canSubmit}
              className="w-full h-11 rounded-xl font-semibold disabled:opacity-40"
              onClick={() => void handleSubmit()}
            >
              {submitting
                ? isEn
                  ? "Submitting..."
                  : "Sender..."
                : isEn
                  ? "Submit report"
                  : "Send rapport"}
            </Button>
          </>
        )}
      </div>
    </main>
  )
}
