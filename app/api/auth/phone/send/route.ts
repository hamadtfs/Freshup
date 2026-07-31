import { NextResponse } from "next/server"
import { createAnonServerClient } from "@/lib/supabase/server"
import type { PhoneAuthRole } from "@/lib/auth/phone"

function isHostedSupabaseUrl(): boolean {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ""
  return /\.supabase\.co\b/i.test(url)
}

function unsupportedPhoneProviderMessage(): string {
  if (isHostedSupabaseUrl()) {
    return (
      "Unsupported phone provider: this app points at a hosted Supabase project. " +
      "supabase/config.toml (including test_otp) only affects local `supabase start`. " +
      "In the Supabase Dashboard: Authentication → Sign In / Providers → Phone — enable Phone and add Twilio, MessageBird, or another provider, or configure the Send SMS hook."
    )
  }
  return (
    "Unsupported phone provider: Auth has no SMS channel. " +
    "For local CLI: set [auth.sms.test_otp] with a quoted E.164 key (e.g. \"+4791234567\" = \"123456\"), run `supabase stop` && `supabase start`, and use that exact phone + OTP. " +
    "Or enable Twilio or the Send SMS hook."
  )
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { phone?: string; role?: string }
    const phone = typeof body.phone === "string" ? body.phone.replace(/\s+/g, "") : ""
    const role: PhoneAuthRole = body.role === "provider" ? "provider" : "customer"

    if (!/^\+\d{7,15}$/.test(phone)) {
      return NextResponse.json({ error: "Invalid phone. Use E.164, e.g. +4712345678" }, { status: 400 })
    }

    const supabase = createAnonServerClient()
    const { error } = await supabase.auth.signInWithOtp({
      phone,
      options: {
        shouldCreateUser: true,
        data: { app_role: role },
      },
    })

    if (error) {
      // Local/dev fallback: some local auth setups return vague sms-provider errors (even "{}").
      // Keep OTP flow testable for the app by allowing a deterministic dev code.
      if (!isHostedSupabaseUrl()) {
        return NextResponse.json({
          ok: true,
          dev_otp: true,
          message: "Dev OTP fallback active. Use code 123456.",
        })
      }
      const message = error.message.includes("Unsupported phone provider")
        ? unsupportedPhoneProviderMessage()
        : error.message
      return NextResponse.json({ error: message }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to send code"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
