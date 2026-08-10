import type { SupabaseClient } from "@supabase/supabase-js"

export type OAuthProvider = "google" | "apple"

function oauthRedirectUrl(): string {
  if (typeof window === "undefined") return "/auth/callback"
  return `${window.location.origin}/auth/callback`
}

function oauthProviderOptions(provider: OAuthProvider) {
  const base = {
    redirectTo: oauthRedirectUrl(),
    // Inspect the authorize URL before navigating so we can catch Site URL fallback.
    skipBrowserRedirect: true as const,
  }

  // Google reuses the last signed-in browser account unless we ask for picker.
  if (provider === "google") {
    return {
      ...base,
      queryParams: {
        prompt: "select_account",
      },
    }
  }

  return base
}

function redirectToFromAuthorizeUrl(authorizeUrl: string): string | null {
  try {
    const u = new URL(authorizeUrl)
    return u.searchParams.get("redirect_to")
  } catch {
    return null
  }
}

export async function signInWithOAuthProvider(
  supabase: SupabaseClient,
  provider: OAuthProvider,
): Promise<{ error?: string }> {
  const expectedRedirect = oauthRedirectUrl()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: oauthProviderOptions(provider),
  })
  if (error) return { error: error.message }
  if (!data?.url) return { error: "No OAuth URL returned" }

  const actualRedirect = redirectToFromAuthorizeUrl(data.url)
  if (
    typeof window !== "undefined" &&
    actualRedirect &&
    !actualRedirect.startsWith(window.location.origin)
  ) {
    return {
      error:
        `Google would send you to ${actualRedirect} instead of ${expectedRedirect}. ` +
        `In Supabase → Authentication → URL Configuration, keep Site URL as production if you want, ` +
        `and add Redirect URLs: ${window.location.origin}/auth/callback and ${window.location.origin}/**`,
    }
  }

  window.location.assign(data.url)
  return {}
}
