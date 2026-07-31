import type { SupabaseClient } from "@supabase/supabase-js"

/** Resolve the caller from `Authorization: Bearer <access_token>` (Supabase JWT). */
export async function getUserIdFromBearer(supabase: SupabaseClient, req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization") ?? req.headers.get("Authorization")
  if (!auth?.startsWith("Bearer ")) return null
  const jwt = auth.slice(7).trim()
  if (!jwt) return null
  const { data, error } = await supabase.auth.getUser(jwt)
  if (error || !data.user) return null
  return data.user.id
}
