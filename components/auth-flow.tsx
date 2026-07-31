"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ArrowLeft, Phone, User, Mail, MapPin, Globe } from "lucide-react"
import { createBrowserSupabaseClient } from "@/lib/supabase/client"
import { normalizeToE164 } from "@/lib/auth/phone"
import { sendPhoneOtpRequest, verifyPhoneSms } from "@/lib/auth/phone-client"
import type { PhoneAuthRole } from "@/lib/auth/phone"

type AuthStep = "welcome" | "phone" | "verify" | "profile" | "location" | "complete"

interface AuthFlowProps {
  onComplete: (user: unknown) => void
  onSkip?: () => void
  language?: "no" | "en"
  onLanguageChange?: (lang: "no" | "en") => void
  /** Passed to Supabase user metadata (customer vs provider). */
  appRole?: PhoneAuthRole
}

export default function AuthFlow({
  onComplete,
  onSkip,
  language = "no",
  onLanguageChange,
  appRole = "customer",
}: AuthFlowProps) {
  const [step, setStep] = useState<AuthStep>("welcome")
  const [phone, setPhone] = useState("")
  const [verificationCode, setVerificationCode] = useState("")
  const [profile, setProfile] = useState({
    name: "",
    email: "",
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const supabase = useMemo(() => createBrowserSupabaseClient() as any, [])
  const hasSupabase = useMemo(() => !!(supabase && typeof supabase.from === "function" && supabase.auth), [supabase])

  const phoneE164 = useMemo(() => normalizeToE164(phone), [phone])

  // Welcome Screen
  const WelcomeScreen = () => (
    <div className="text-center space-y-8 py-12">
      <div className="space-y-4">
        <div className="w-20 h-20 bg-primary rounded-2xl flex items-center justify-center mx-auto">
          <span className="text-3xl text-primary-foreground">F</span>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground mb-2">
            {language === "en" ? "Welcome to Fresh Up" : "Velkommen til Fresh Up"}
          </h1>
          <p className="text-muted-foreground">
            {language === "en" ? "On-demand beauty services at your fingertips" : "Skjønnhetstjenester på forespørsel"}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <Button
          className="w-full h-14 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-lg font-semibold"
          onClick={() => setStep("phone")}
        >
          {language === "en" ? "Get Started" : "Kom i gang"}
        </Button>

        {onSkip && (
          <Button variant="ghost" className="w-full text-muted-foreground hover:text-foreground" onClick={onSkip}>
            {language === "en" ? "Continue as Guest" : "Fortsett som gjest"}
          </Button>
        )}
      </div>

      <div className="text-xs text-gray-500 px-4">
        {language === "en"
          ? "By continuing, you agree to our Terms of Service and Privacy Policy"
          : "Ved å fortsette godtar du våre vilkår for bruk og personvernregler"}
      </div>

      {onLanguageChange && (
        <button
          className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mx-auto transition-colors"
          onClick={() => onLanguageChange(language === "no" ? "en" : "no")}
        >
          <Globe className="h-3 w-3" />
          <span>{language === "no" ? "English" : "Norsk"}</span>
        </button>
      )}
    </div>
  )

  // Phone Input Screen
  const PhoneScreen = () => (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" className="rounded-lg bg-muted" onClick={() => setStep("welcome")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-semibold text-foreground">{language === "en" ? "Enter your phone" : "Skriv inn telefonnummer"}</h1>
      </div>

      <div className="space-y-4">
        <div className="text-center py-8">
          <div className="w-16 h-16 bg-muted rounded-xl flex items-center justify-center mx-auto mb-4">
            <Phone className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="text-gray-600">
            {language === "en" ? "We'll send you a verification code" : "Vi sender deg en bekreftelseskode"}
          </p>
        </div>

        <div className="space-y-4">
          <div className="relative">
            <Input
              type="tel"
              placeholder="+47 12 34 56 78"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="h-14 text-lg pl-4 bg-card border-border"
            />
          </div>

          {error && <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</div>}

          <Button
            className="w-full h-14 bg-green-600 hover:bg-green-700 text-white rounded-2xl text-lg font-semibold"
            onClick={() => void sendVerificationCode()}
            disabled={!phoneE164 || loading}
          >
            {loading ? (language === "en" ? "Sending..." : "Sender...") : language === "en" ? "Send Code" : "Send kode"}
          </Button>
        </div>
      </div>
    </div>
  )

  // Verification Screen
  const VerifyScreen = () => (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" className="rounded-lg bg-muted" onClick={() => setStep("phone")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-semibold text-foreground">{language === "en" ? "Verify your phone" : "Bekreft telefonnummer"}</h1>
      </div>

      <div className="space-y-4">
        <div className="text-center py-8">
          <div className="w-16 h-16 bg-muted rounded-xl flex items-center justify-center mx-auto mb-4">
            <Phone className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="text-gray-600 mb-2">
            {language === "en" ? "Enter the code sent to" : "Skriv inn koden sendt til"}
          </p>
          <p className="font-semibold text-gray-900">{phone}</p>
        </div>

        <div className="space-y-4">
          <Input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder={language === "en" ? "Code from SMS" : "Kode fra SMS"}
            value={verificationCode}
            onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
            className="h-14 text-lg text-center tracking-widest"
            maxLength={8}
          />

          {error && <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</div>}

          <Button
            className="w-full h-14 bg-green-600 hover:bg-green-700 text-white rounded-2xl text-lg font-semibold"
            onClick={() => void verifyCode()}
            disabled={verificationCode.replace(/\D/g, "").length < 4 || loading}
          >
            {loading ? (language === "en" ? "Verifying..." : "Bekrefter...") : language === "en" ? "Verify" : "Bekreft"}
          </Button>

          <Button variant="ghost" className="w-full text-gray-500" onClick={() => void sendVerificationCode()}>
            {language === "en" ? "Resend code" : "Send kode på nytt"}
          </Button>
        </div>
      </div>
    </div>
  )

  // Profile Setup Screen
  const ProfileScreen = () => (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" className="rounded-lg bg-muted" onClick={() => setStep("verify")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-semibold text-foreground">{language === "en" ? "Complete your profile" : "Fullfør profilen din"}</h1>
      </div>

      <div className="space-y-4">
        <div className="text-center py-4">
          <div className="w-16 h-16 bg-muted rounded-xl flex items-center justify-center mx-auto mb-4">
            <User className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="text-gray-600">
            {language === "en" ? "Help us personalize your experience" : "Hjelp oss å tilpasse opplevelsen din"}
          </p>
        </div>

        <div className="space-y-4">
          <div className="relative">
            <User className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              type="text"
              placeholder={language === "en" ? "Full name" : "Fullt navn"}
              value={profile.name}
              onChange={(e) => setProfile((prev) => ({ ...prev, name: e.target.value }))}
              className="h-14 text-lg pl-12 bg-card border-border"
            />
          </div>

          <div className="relative">
            <Mail className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              type="email"
              placeholder={language === "en" ? "Email address" : "E-postadresse"}
              value={profile.email}
              onChange={(e) => setProfile((prev) => ({ ...prev, email: e.target.value }))}
              className="h-14 text-lg pl-12 bg-card border-border"
            />
          </div>

          {error && <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</div>}

          <Button
            className="w-full h-14 bg-green-600 hover:bg-green-700 text-white rounded-2xl text-lg font-semibold"
            onClick={() => void saveProfile()}
            disabled={!profile.name || loading}
          >
            {loading ? (language === "en" ? "Saving..." : "Lagrer...") : language === "en" ? "Continue" : "Fortsett"}
          </Button>
        </div>
      </div>
    </div>
  )

  // Location Permission Screen
  const LocationScreen = () => (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" className="rounded-lg bg-muted" onClick={() => setStep("profile")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-semibold text-foreground">{language === "en" ? "Enable location" : "Aktiver posisjon"}</h1>
      </div>

      <div className="space-y-4">
        <div className="text-center py-8">
          <div className="w-16 h-16 bg-muted rounded-xl flex items-center justify-center mx-auto mb-4">
            <MapPin className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            {language === "en" ? "Find nearby professionals" : "Finn tilbydere i nærheten"}
          </h3>
          <p className="text-gray-600">
            {language === "en"
              ? "We need your location to show available beauty professionals near you"
              : "Vi trenger posisjonen din for å vise tilgjengelige tilbydere i nærheten"}
          </p>
        </div>

        <div className="space-y-4">
          <Button
            className="w-full h-14 bg-green-600 hover:bg-green-700 text-white rounded-2xl text-lg font-semibold"
            onClick={() => void requestLocation()}
          >
            {language === "en" ? "Enable Location" : "Aktiver posisjon"}
          </Button>

          <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => setStep("complete")}>
            {language === "en" ? "Skip for now" : "Hopp over"}
          </Button>
        </div>
      </div>
    </div>
  )

  // Complete Screen
  const CompleteScreen = () => (
    <div className="text-center space-y-8 py-12">
      <div className="space-y-4">
        <div className="w-20 h-20 bg-green-100 rounded-2xl flex items-center justify-center mx-auto">
          <span className="text-3xl">✓</span>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground mb-2">
            {language === "en" ? "Welcome to Fresh Up!" : "Velkommen til Fresh Up!"}
          </h1>
          <p className="text-muted-foreground">
            {language === "en" ? "You're all set to book your first service" : "Du er klar til å bestille din første tjeneste"}
          </p>
        </div>
      </div>

      <Button
        className="w-full h-14 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-lg font-semibold"
        onClick={() => onComplete({})}
      >
        {language === "en" ? "Start Booking" : "Start bestilling"}
      </Button>
    </div>
  )

  const sendVerificationCode = async () => {
    setLoading(true)
    setError(null)
    try {
      if (!hasSupabase) {
        setError(language === "en" ? "Supabase is not configured." : "Supabase er ikke konfigurert.")
        return
      }
      if (!phoneE164) {
        setError(language === "en" ? "Invalid phone (use E.164, e.g. +4712345678)." : "Ugyldig telefon (bruk E.164, f.eks. +4712345678).")
        return
      }
      const { error: sendErr } = await sendPhoneOtpRequest(phoneE164, appRole)
      if (sendErr) {
        setError(sendErr)
        return
      }
      setStep("verify")
    } finally {
      setLoading(false)
    }
  }

  const verifyCode = async () => {
    setLoading(true)
    setError(null)
    try {
      if (!hasSupabase || !phoneE164) return
      const token = verificationCode.replace(/\D/g, "")
      if (token.length < 4) {
        setError(language === "en" ? "Enter the code from SMS." : "Skriv inn koden fra SMS.")
        return
      }
      const { error: vErr } = await verifyPhoneSms(supabase, phoneE164, token)
      if (vErr) {
        setError(vErr.message)
        return
      }
      setStep("profile")
    } finally {
      setLoading(false)
    }
  }

  const saveProfile = async () => {
    setLoading(true)
    setError(null)
    try {
      if (hasSupabase && supabase.auth?.getUser) {
        const { data: u } = await supabase.auth.getUser()
        const uid = u?.user?.id
        if (uid) {
          await supabase.from("profiles").upsert(
            {
              id: uid,
              display_name: profile.name,
              email: profile.email || null,
              phone: phoneE164,
            },
            { onConflict: "id" },
          )
        }
      }
      setStep("location")
    } catch {
      setError(language === "en" ? "Failed to save profile" : "Kunne ikke lagre profil")
    } finally {
      setLoading(false)
    }
  }

  const requestLocation = async () => {
    try {
      await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject)
      })
      setStep("complete")
    } catch {
      setStep("complete")
    }
  }

  const renderStep = () => {
    switch (step) {
      case "welcome":
        return <WelcomeScreen />
      case "phone":
        return <PhoneScreen />
      case "verify":
        return <VerifyScreen />
      case "profile":
        return <ProfileScreen />
      case "location":
        return <LocationScreen />
      case "complete":
        return <CompleteScreen />
      default:
        return <WelcomeScreen />
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-md p-6">{renderStep()}</div>
    </div>
  )
}
