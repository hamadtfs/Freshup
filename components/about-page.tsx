"use client"

import { ChevronLeft, Mail, MapPin, Headphones } from "lucide-react"

interface AboutPageProps {
  onBack: () => void
  language?: "no" | "en"
  onOpenSupport?: () => void
}

const APP_VERSION = "1.0.0"

export default function AboutPage({
  onBack,
  language = "no",
  onOpenSupport,
}: AboutPageProps) {
  const isEn = language === "en"

  const CONTACT_ROWS = [
    {
      id: "email",
      icon: Mail,
      label: isEn ? "Email" : "E-post",
      value: "contact@freshup.app",
      onClick: () => {
        if (typeof window !== "undefined") {
          window.location.href = "mailto:contact@freshup.app"
        }
      },
    },
    {
      id: "location",
      icon: MapPin,
      label: isEn ? "Location" : "Sted",
      value: isEn ? "Oslo, Norway" : "Oslo, Norge",
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
          {isEn ? "About" : "Om"}
        </h1>
        <div className="w-10" />
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-6">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="mb-5">
            <svg width="88" height="44" viewBox="0 0 100 50" aria-hidden>
              <rect
                x="2"
                y="2"
                width="96"
                height="46"
                rx="23"
                fill="currentColor"
                className="text-foreground"
              />
              <text
                x="25"
                y="33"
                textAnchor="middle"
                fill="currentColor"
                className="text-background"
                fontFamily="system-ui"
                fontWeight="800"
                fontSize="20"
              >
                F
              </text>
              <text
                x="50"
                y="33"
                textAnchor="middle"
                fill="currentColor"
                className="text-background"
                fontFamily="system-ui"
                fontWeight="800"
                fontSize="20"
              >
                U
              </text>
              <text
                x="75"
                y="33"
                textAnchor="middle"
                fill="currentColor"
                className="text-background"
                fontFamily="system-ui"
                fontWeight="800"
                fontSize="20"
              >
                P
              </text>
            </svg>
          </div>
          <p className="text-lg font-bold text-foreground tracking-tight">
            Fresh Up
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {isEn ? "Tap. Match. Done." : "Trykk. Match. Ferdig."}
          </p>
        </div>

        <section className="mb-6">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            {isEn ? "Our mission" : "Vår misjon"}
          </p>
          <p className="text-sm text-foreground leading-relaxed">
            {isEn
              ? "Fresh Up connects you with qualified local providers in real time — hair, beauty, car care, pets, home, and health. Book, match, and get it done without waiting on replies."
              : "Fresh Up kobler deg med kvalifiserte lokale tilbydere i sanntid — hår, skjønnhet, bilpleie, husdyr, hjem og helse. Bestill, match og bli ferdig uten å vente på svar."}
          </p>
        </section>

        <section className="mb-6">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            {isEn ? "How it works" : "Slik fungerer det"}
          </p>
          <div className="space-y-2">
            {[
              {
                step: "1",
                title: isEn ? "Choose a service" : "Velg tjeneste",
                body: isEn
                  ? "Pick what you need and where you want it."
                  : "Velg hva du trenger og hvor du vil ha det.",
              },
              {
                step: "2",
                title: isEn ? "Get matched instantly" : "Bli matched med en gang",
                body: isEn
                  ? "We find an available provider nearby, live."
                  : "Vi finner en tilgjengelig tilbyder i nærheten, live.",
              },
              {
                step: "3",
                title: isEn ? "Pay in the app" : "Betal i appen",
                body: isEn
                  ? "Card, Apple Pay, and Vipps — secure and simple."
                  : "Kort, Apple Pay og Vipps — trygt og enkelt.",
              },
            ].map((item) => (
              <div
                key={item.step}
                className="flex gap-3 rounded-xl border border-border bg-card p-4"
              >
                <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0 text-sm font-bold text-foreground">
                  {item.step}
                </div>
                <div className="min-w-0 text-left">
                  <p className="text-sm font-semibold text-foreground">
                    {item.title}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {item.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-6">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            {isEn ? "Contact" : "Kontakt"}
          </p>
          <div className="space-y-2">
            {CONTACT_ROWS.map((row) => {
              const Inner = (
                <>
                  <div className="w-11 h-11 bg-muted rounded-lg flex items-center justify-center shrink-0">
                    <row.icon className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="text-left min-w-0">
                    <p className="text-xs text-muted-foreground">{row.label}</p>
                    <p className="text-sm font-semibold text-foreground truncate">
                      {row.value}
                    </p>
                  </div>
                </>
              )
              if (row.onClick) {
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={row.onClick}
                    className="w-full flex items-center gap-4 bg-card border border-border p-4 rounded-xl hover:bg-muted/50 transition-colors"
                  >
                    {Inner}
                  </button>
                )
              }
              return (
                <div
                  key={row.id}
                  className="w-full flex items-center gap-4 bg-card border border-border p-4 rounded-xl"
                >
                  {Inner}
                </div>
              )
            })}
          </div>
        </section>

        {onOpenSupport ? (
          <section className="mb-8">
            <button
              type="button"
              onClick={onOpenSupport}
              className="w-full flex items-center gap-4 bg-card border border-border p-4 rounded-xl hover:bg-muted/50 transition-colors"
            >
              <div className="w-11 h-11 bg-muted rounded-lg flex items-center justify-center shrink-0">
                <Headphones className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-foreground">
                  {isEn ? "Need help?" : "Trenger du hjelp?"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isEn
                    ? "Open Support for email and FAQ"
                    : "Åpne Kundeservice for e-post og FAQ"}
                </p>
              </div>
            </button>
          </section>
        ) : null}

        <div className="text-center space-y-1 pt-2">
          <p className="text-xs text-muted-foreground">
            {isEn ? "Version" : "Versjon"} {APP_VERSION}
          </p>
          <p className="text-xs text-muted-foreground">© 2026 Fresh Up AS</p>
        </div>
      </div>
    </main>
  )
}
