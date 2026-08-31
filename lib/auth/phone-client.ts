import type { SupabaseClient } from "@supabase/supabase-js"
import type { PhoneAuthRole } from "@/lib/auth/phone"

export async function sendPhoneOtpRequest(
  phoneE164: string,
  role: PhoneAuthRole,
): Promise<{ error?: string; code?: string; created?: boolean }> {
  const res = await fetch("/api/auth/phone/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: phoneE164, role }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    error?: string
    code?: string
    dev_otp?: boolean
    message?: string
    created?: boolean
  }
  if (data.dev_otp) return { error: `DEV_OTP:${data.message ?? "Use code 123456"}` }
  if (!res.ok) return { error: data.error ?? "Could not send code", code: data.code }
  return { created: data.created !== false }
}

export function verifyPhoneSms(
  supabase: SupabaseClient,
  phoneE164: string,
  token: string,
) {
  return supabase.auth.verifyOtp({ phone: phoneE164, token, type: "sms" })
}

/** Link phone onto the current OAuth session. */
export async function sendLinkPhoneOtp(
  supabase: SupabaseClient,
  phoneE164: string,
) {
  return supabase.auth.updateUser({ phone: phoneE164 })
}

export function verifyLinkPhoneSms(
  supabase: SupabaseClient,
  phoneE164: string,
  token: string,
) {
  return supabase.auth.verifyOtp({
    phone: phoneE164,
    token,
    type: "phone_change",
  })
}

export async function fetchRegistrationStatus(accessTokenUserId: string): Promise<{
  incomplete: boolean
  hasPhone: boolean
  displayName: string | null
} | null> {
  try {
    const res = await fetch("/api/auth/registration-status", {
      headers: { "x-user-id": accessTokenUserId },
    })
    if (!res.ok) return null
    const json = (await res.json()) as {
      incomplete?: boolean
      hasPhone?: boolean
      displayName?: string | null
    }
    return {
      incomplete: Boolean(json.incomplete),
      hasPhone: Boolean(json.hasPhone),
      displayName: json.displayName ?? null,
    }
  } catch {
    return null
  }
}
