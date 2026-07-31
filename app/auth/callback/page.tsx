"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { completeOAuthSession } from "@/lib/auth/complete-oauth-session"
import { consumeOAuthPending } from "@/lib/auth/oauth-pending"
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
      if (!userId) {
        if (!cancelled) setError("No session found after sign-in.")
        return
      }

      try {
        const pending = consumeOAuthPending()
        await completeOAuthSession(supabase, userId, pending)
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Could not finish sign-in."
        if (!cancelled) setError(message)
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
