"use client"

import AuthFlow from "@/components/auth-flow"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

type Language = "no" | "en"

const LANGUAGE_STORAGE_KEY = "freshup.language"

function readStoredLanguage(): Language | null {
  if (typeof window === "undefined") return null
  const v = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
  if (v === "no" || v === "en") return v
  return null
}

function writeStoredLanguage(language: Language) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
}

export default function AuthPage() {
  const router = useRouter()
  const [language, setLanguage] = useState<Language>(
    () => readStoredLanguage() ?? "no",
  )

  useEffect(() => {
    writeStoredLanguage(language)
  }, [language])

  const handleAuthComplete = (user: any) => {
    // Store user session and redirect to main app
    router.push("/")
  }

  const handleGuestBooking = () => {
    // Allow guest booking with limited features
    router.push("/?guest=true")
  }

  return (
    <AuthFlow
      onComplete={handleAuthComplete}
      onSkip={handleGuestBooking}
      language={language}
      onLanguageChange={setLanguage}
    />
  )
}
