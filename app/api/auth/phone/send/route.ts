import { NextResponse } from "next/server"
import { createAdminClient, createAnonServerClient } from "@/lib/supabase/server"
import { normalizeToE164, type PhoneAuthRole } from "@/lib/auth/phone"
import { resolvePhoneIdentity } from "@/lib/auth/phone-identity"

function isHostedAuthUrl(): boolean {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ""
  return /\.supabase\.co\b/i.test(url) || /auth\.freshup\.app\b/i.test(url)
}

function unsupportedPhoneProviderMessage(): string {
  if (isHostedAuthUrl()) {
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
    const body = (await req.json()) as {
      phone?: string
      role?: string
      /** When true, attach phone to the Authorization bearer session (no new user). */
      link?: boolean
    }
    const phone = typeof body.phone === "string" ? normalizeToE164(body.phone) : null
    const role: PhoneAuthRole = body.role === "provider" ? "provider" : "customer"
    const link = body.link === true

    if (!phone) {
      return NextResponse.json({ error: "Invalid phone. Use E.164, e.g. +4712345678" }, { status: 400 })
    }

    if (link) {
      // Client must call updateUser({ phone }) with the user JWT — server cannot
      // start phone_change without that session. This branch is a no-op guard.
      return NextResponse.json({
        error:
          "Phone linking must use the signed-in session (updateUser + phone_change OTP).",
        code: "USE_SESSION_LINK",
      }, { status: 400 })
    }

    let shouldCreateUser = true
    try {
      const admin = createAdminClient()
      const resolution = await resolvePhoneIdentity(admin, phone)
      if (resolution.kind === "profile_oauth_only") {
        const providers = resolution.providers.filter((p) =>
          ["google", "apple"].includes(p),
        )
        const label =
          providers.length > 0
            ? providers.map((p) => (p === "google" ? "Google" : "Apple")).join(" / ")
            : "Google or Apple"
        return NextResponse.json(
          {
            error: `This number belongs to an existing account. Sign in with ${label}, then add this phone in your profile.`,
            code: "PHONE_ON_OAUTH_ACCOUNT",
            providers: resolution.providers,
          },
          { status: 409 },
        )
      }
      if (resolution.kind === "auth_phone") {
        // Existing Auth phone identity — never create a second user.
        shouldCreateUser = false
      }
    } catch (resolveErr) {
      // If RPC/migration is not applied yet, fall through to default create.
      console.warn("[auth/phone/send] identity resolve skipped:", resolveErr)
    }

    const supabase = createAnonServerClient()
    const { error } = await supabase.auth.signInWithOtp({
      phone,
      options: {
        shouldCreateUser,
        data: { app_role: role },
      },
    })

    if (error) {
      if (!isHostedAuthUrl()) {
        return NextResponse.json({
          ok: true,
          dev_otp: true,
          message: "Dev OTP fallback active. Use code 123456.",
        })
      }
      // Existing user + shouldCreateUser false still sends OTP; "Signups not
      // allowed" means the number is unknown — treat as new signup once.
      if (
        !shouldCreateUser &&
        /signup|not allowed|user not found/i.test(error.message)
      ) {
        const retry = await supabase.auth.signInWithOtp({
          phone,
          options: {
            shouldCreateUser: true,
            data: { app_role: role },
          },
        })
        if (!retry.error) return NextResponse.json({ ok: true, created: true })
        const message = retry.error.message.includes("Unsupported phone provider")
          ? unsupportedPhoneProviderMessage()
          : retry.error.message
        return NextResponse.json({ error: message }, { status: 400 })
      }
      const message = error.message.includes("Unsupported phone provider")
        ? unsupportedPhoneProviderMessage()
        : error.message
      return NextResponse.json({ error: message }, { status: 400 })
    }

    return NextResponse.json({
      ok: true,
      created: shouldCreateUser,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to send code"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
