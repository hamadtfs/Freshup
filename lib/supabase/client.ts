import { createClient, type SupabaseClient } from "@supabase/supabase-js"

let browserClient: SupabaseClient | null = null

export function createBrowserSupabaseClient() {
  if (browserClient) return browserClient
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  if (!url || !anon) {
    // Return a dummy client-like object if not configured
    // @ts-expect-error partial
    return {}
  }
  browserClient = createClient(url, anon, { auth: { persistSession: true } })
  return browserClient
}
