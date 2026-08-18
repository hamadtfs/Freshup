"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { ChevronLeft, Lock, Mail, ChevronDown } from "lucide-react"

interface SupportPageProps {
  onBack: () => void
  language?: "no" | "en"
  onOpenChat?: () => void
}

export default function SupportPage({
  onBack,
  language = "no",
}: SupportPageProps) {
  const isEn = language === "en"
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null)

  const CONTACT_OPTIONS = [
    {
      id: "chat",
      icon: Lock,
      title: isEn ? "Chat with us" : "Chat med oss",
      subtitle: isEn ? "Currently closed" : "Stengt",
      locked: true,
      onClick: undefined as (() => void) | undefined,
    },
    {
      id: "email",
      icon: Mail,
      title: isEn ? "Send email" : "Send e-post",
      subtitle: "support@freshup.app",
      locked: false,
      onClick: () => {
        if (typeof window !== "undefined") {
          window.location.href = "mailto:support@freshup.app"
        }
      },
    },
  ]

  const FAQ_ITEMS = [
    {
      question: isEn ? "How do I order?" : "Hvordan bestiller jeg?",
      answer: isEn
        ? "Select the service you want. We automatically match you with an available provider nearby - in real time."
        : "Velg tjenesten du ønsker. Vi matcher deg automatisk med en tilgjengelig tilbyder i nærheten - i sanntid.",
    },
    {
      question: isEn
        ? "When will I be matched with a provider?"
        : "Når blir jeg koblet med en tilbyder?",
      answer: isEn
        ? "Usually within a few seconds. You don't have to wait for replies or approval."
        : "Som regel innen få sekunder. Du slipper å vente på svar eller godkjenning.",
    },
    {
      question: isEn ? "Can I cancel?" : "Kan jeg avbestille?",
      answer: isEn
        ? "Yes, as long as the job hasn't started. Any terms are shown before you confirm your order."
        : "Ja, så lenge jobben ikke er startet. Eventuelle vilkår vises før du bekrefter bestillingen.",
    },
    {
      question: isEn ? "How do I pay?" : "Hvordan betaler jeg?",
      answer: isEn
        ? "Payment is made in the app when ordering. We support Apple Pay, card and Vipps."
        : "Betaling skjer i appen ved bestilling. Vi støtter Apple Pay, kort og Vipps.",
    },
    {
      question: isEn ? "What if I'm not satisfied?" : "Hva hvis jeg ikke er fornøyd?",
      answer: isEn
        ? "Contact us directly in the app. We follow up and ensure a solution."
        : "Ta kontakt med oss direkte i appen. Vi følger opp og sørger for en løsning.",
    },
  ]

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
          {isEn ? "Support" : "Kundeservice"}
        </h1>
        <div className="w-10" />
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-6">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          {isEn ? "Contact us" : "Kontakt oss"}
        </p>
        <div className="space-y-2 mb-6">
          {CONTACT_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={option.onClick}
              disabled={option.locked || !option.onClick}
              className={cn(
                "w-full flex items-center gap-4 bg-card border border-border p-4 rounded-xl transition-colors",
                option.locked
                  ? "opacity-55 cursor-not-allowed"
                  : "hover:bg-muted/50",
              )}
            >
              <div className="w-11 h-11 bg-muted rounded-lg flex items-center justify-center">
                <option.icon className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-foreground">
                  {option.title}
                </p>
                <p className="text-xs text-muted-foreground">{option.subtitle}</p>
              </div>
            </button>
          ))}
        </div>

        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          {isEn ? "Frequently asked questions" : "Ofte stilte spørsmål"}
        </p>
        <div className="space-y-2 mb-6">
          {FAQ_ITEMS.map((item, index) => (
            <button
              key={index}
              type="button"
              className="w-full bg-card border border-border rounded-xl p-4 text-left"
              onClick={() =>
                setExpandedFaq(expandedFaq === index ? null : index)
              }
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground pr-4">
                  {item.question}
                </p>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform shrink-0",
                    expandedFaq === index && "rotate-180",
                  )}
                />
              </div>
              {expandedFaq === index && (
                <p className="text-xs text-muted-foreground mt-3 leading-relaxed animate-in fade-in slide-in-from-top-2 duration-200">
                  {item.answer}
                </p>
              )}
            </button>
          ))}
        </div>

        <p className="text-xs text-muted-foreground text-center">
          {isEn
            ? "Fresh Up is available when you need it. Providers set their own availability in the app."
            : "Fresh Up er tilgjengelig når du trenger det. Tilbydere setter sin egen tilgjengelighet i appen."}
        </p>
      </div>
    </main>
  )
}
