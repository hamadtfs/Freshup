"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { completeOAuthSession } from "@/lib/auth/complete-oauth-session"
import { consumeOAuthPending } from "@/lib/auth/oauth-pending"
import { fetchAccountRoles } from "@/lib/auth/fetch-account-roles"
import { writeLoginRoleIntent } from "@/lib/auth/login-role-intent"
import { setNeedProviderLogin } from "@/lib/auth/need-provider-login"
import { isProviderSignupIncomplete } from "@/lib/auth/resolve-account-roles"
import {
  captureAndSaveCustomerSignupLocationWeb,
} from "@/lib/customer/save-signup-location-web"
import {
  beginProviderSignupInProgress,
  setProviderSignupResumeStep,
} from "@/lib/auth/provider-signup-gate"
import { createBrowserSupabaseClient } from "@/lib/supabase/client"

export default function AuthCallbackPage() {
  const router = useRouter()
  const supabase = useMemo(() => createBrowserSupabaseClient() as any, [])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function finishAuth() {
      const params = new URLSearchParams(window.location.search)
      const oauthError =
        params.get("error_description") || params.get("error")
      if (oauthError) {
        if (!cancelled) setError(oauthError)
        return
      }

      const code = params.get("code")
      if (code) {
        const { error: exchangeError } =
          await supabase.auth.exchangeCodeForSession(code)
        if (exchangeError) {
          if (!cancelled) setError(exchangeError.message)
          return
        }
      }

      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) {
        if (!cancelled) setError(sessionError.message)
        return
      }

      const userId = data.session?.user?.id
      const accessToken = data.session?.access_token as string | undefined
      if (!userId) {
        if (!cancelled) setError("No session found after sign-in.")
        return
      }

      let pending = null as ReturnType<typeof consumeOAuthPending>
      try {
        pending = consumeOAuthPending()
        await completeOAuthSession(supabase, userId, pending)
        if (pending?.role === "customer") {
          void captureAndSaveCustomerSignupLocationWeb(userId)
        }
        // Become-a-provider phone-first signup — resume profile→… after OAuth.
        if (
          pending?.role === "provider" &&
          pending.providerSignupContinue &&
          !pending.providerOnboarding
        ) {
          beginProviderSignupInProgress("profile")
          setProviderSignupResumeStep("profile")
        }
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Could not finish sign-in."
        if (!cancelled) setError(message)
        return
      }

      const providerLoginIntent =
        pending?.role === "provider" && pending.providerLoginOnly

      if (providerLoginIntent) {
        writeLoginRoleIntent("provider")
        const roles = await fetchAccountRoles({
          accessToken,
          intent: "provider",
        })
        if (roles?.has_provider && roles.provider_has_skills) {
          if (!cancelled) router.replace("/")
          return
        }
        if (isProviderSignupIncomplete(roles)) {
          beginProviderSignupInProgress("profile")
          setProviderSignupResumeStep("profile")
          if (!cancelled) router.replace("/")
          return
        }
        setNeedProviderLogin()
        if (!cancelled) router.replace("/")
        return
      }

      if (!cancelled) router.replace("/")
    }

    void finishAuth()
    return () => {
      cancelled = true
    }
  }, [router, supabase])

  return (
    <main className="mx-auto flex h-[100dvh] w-full max-w-md items-center justify-center bg-background px-6">
      {error ? (
        <div className="space-y-4 text-center">
          <p className="text-sm text-red-600">{error}</p>
          <button
            type="button"
            onClick={() => router.replace("/")}
            className="rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background"
          >
            Back to app
          </button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Finishing sign-in...</p>
      )}
    </main>
  )
}
