export type PhoneAuthRole = "customer" | "provider"

/** Normalize user input to E.164. Assumes Norway (+47) when only local digits are given. */
export function normalizeToE164(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const noSpaces = trimmed.replace(/\s+/g, "")
  if (noSpaces.startsWith("+")) {
    return /^\+\d{7,15}$/.test(noSpaces) ? noSpaces : null
  }
  const digits = noSpaces.replace(/\D/g, "")
  if (digits.length < 8 || digits.length > 15) return null
  if (digits.startsWith("47")) return `+${digits}`
  return `+47${digits}`
}
