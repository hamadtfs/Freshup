import { createClient } from "@supabase/supabase-js"

export function createAdminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY must be set")
  if (!url) throw new Error("SUPABASE_URL must be set")
  return createClient(url, key, {
    auth: { persistSession: false },
  })
}

export function createAnonServerClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL and SUPABASE_ANON_KEY (or NEXT_PUBLIC_*) for server auth routes")
  }
  return createClient(url, key, {
    auth: { persistSession: false },
  })
}
