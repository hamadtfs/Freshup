export type PhoneAuthRole = "customer" | "provider"

/**
 * Normalize user / Auth phone values to E.164 for Twilio.
 * Supabase Auth stores phones as digits only (47908…), which Twilio rejects
 * as 21211 unless prefixed with +. Assumes Norway (+47) for 8-digit local input.
 */
export function normalizeToE164(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  let s = trimmed.replace(/[\s()-]/g, "")
  if (s.startsWith("00")) s = `+${s.slice(2)}`
  if (s.startsWith("+")) {
    const digits = s.slice(1).replace(/\D/g, "")
    return digits.length >= 7 && digits.length <= 15 ? `+${digits}` : null
  }
  const digits = s.replace(/\D/g, "")
  if (digits.length < 8 || digits.length > 15) return null
  if (digits.length === 8) return `+47${digits}`
  if (digits.startsWith("47")) return `+${digits}`
  return `+${digits}`
}
