import type { SupabaseClient } from "@supabase/supabase-js"
import type { PhoneAuthRole } from "@/lib/auth/phone"

export async function sendPhoneOtpRequest(phoneE164: string, role: PhoneAuthRole): Promise<{ error?: string }> {
  const res = await fetch("/api/auth/phone/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: phoneE164, role }),
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string; dev_otp?: boolean; message?: string }
  if (!res.ok) return { error: data.error ?? "Could not send code" }
  if (data.dev_otp) return { error: `DEV_OTP:${data.message ?? "Use code 123456"}` }
  return {}
}

export function verifyPhoneSms(supabase: SupabaseClient, phoneE164: string, token: string) {
  return supabase.auth.verifyOtp({ phone: phoneE164, token, type: "sms" })
}
