import type { SupabaseClient } from "@supabase/supabase-js"
import { normalizeToE164 } from "./phone"

/** Digits-only and E.164 forms Auth / profiles may store. */
export function phoneLookupVariants(phoneE164: string): string[] {
  const e164 = normalizeToE164(phoneE164)
  if (!e164) return []
  const digits = e164.replace(/\D/g, "")
  const variants = new Set<string>([e164, digits, `+${digits}`])
  if (digits.startsWith("47") && digits.length === 10) {
    variants.add(digits.slice(2))
  }
  return [...variants]
}

export type PhoneIdentityResolution =
  | { kind: "auth_phone"; userId: string }
  | {
      kind: "profile_oauth_only"
      userId: string
      providers: string[]
    }
  | { kind: "new" }

function providerIdsFromIdentities(
  identities: Array<{ provider?: string }> | null | undefined,
): string[] {
  const out: string[] = []
  for (const identity of identities || []) {
    const p = String(identity.provider || "").trim()
    if (p && p !== "phone" && !out.includes(p)) out.push(p)
  }
  return out
}

function authPhoneMatches(
  authPhone: string | null | undefined,
  variants: string[],
): boolean {
  if (!authPhone) return false
  const authDigits = String(authPhone).replace(/\D/g, "")
  return variants.some((v) => v.replace(/\D/g, "") === authDigits)
}

/**
 * Decide whether phone OTP should sign into an existing Auth user, block
 * create (number belongs to an OAuth account without a phone identity), or
 * allow a new phone user.
 */
export async function resolvePhoneIdentity(
  admin: SupabaseClient,
  phoneE164: string,
): Promise<PhoneIdentityResolution> {
  const variants = phoneLookupVariants(phoneE164)
  if (variants.length === 0) return { kind: "new" }

  const { data: authUserId, error: rpcErr } = await admin.rpc(
    "auth_user_id_for_phone",
    { p_phone: phoneE164 },
  )
  if (!rpcErr && authUserId) {
    return { kind: "auth_phone", userId: String(authUserId) }
  }

  const { data: profiles, error: profileErr } = await admin
    .from("profiles")
    .select("id, phone")
    .in("phone", variants)
    .limit(5)

  if (profileErr) throw profileErr

  const profileIds = [...new Set((profiles || []).map((p) => String(p.id)))]

  for (const userId of profileIds) {
    const { data, error } = await admin.auth.admin.getUserById(userId)
    if (error || !data.user) continue
    if (authPhoneMatches(data.user.phone, variants)) {
      return { kind: "auth_phone", userId: data.user.id }
    }
    const providers = providerIdsFromIdentities(data.user.identities)
    if (providers.length > 0 || data.user.email) {
      return {
        kind: "profile_oauth_only",
        userId: data.user.id,
        providers: providers.length > 0 ? providers : ["email"],
      }
    }
  }

  return { kind: "new" }
}

export function isCustomerRegistrationIncomplete(input: {
  displayName?: string | null
  metaName?: string | null
  metaFullName?: string | null
}): boolean {
  const name = String(
    input.displayName || input.metaFullName || input.metaName || "",
  ).trim()
  return name.length < 2
}
