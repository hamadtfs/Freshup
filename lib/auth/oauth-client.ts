import type { SupabaseClient } from "@supabase/supabase-js"

export type OAuthProvider = "google" | "apple"

function oauthRedirectUrl(): string {
  if (typeof window === "undefined") return "/auth/callback"
  return `${window.location.origin}/auth/callback`
}

function oauthProviderOptions(provider: OAuthProvider) {
  const base = {
    redirectTo: oauthRedirectUrl(),
    skipBrowserRedirect: false as const,
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

export async function signInWithOAuthProvider(
  supabase: SupabaseClient,
  provider: OAuthProvider,
): Promise<{ error?: string }> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: oauthProviderOptions(provider),
  })
  if (error) return { error: error.message }
  return {}
}
