/**
 * Send SMS Auth Hook — Supabase calls this instead of the default SMS sender when configured.
 * Set SMS_DEV_LOG_OTP=true (secret) to print OTP to function logs (development / debugging).
 * In production, add your SMS provider here and avoid logging OTPs.
 *
 * Dashboard: Authentication → Hooks → Send SMS → HTTPS → this function URL
 * Local: enable [auth.hook.send_sms] in config.toml (see comment block there)
 */
import { Webhook } from "npm:standardwebhooks@1.0.0"

type SmsPayload = {
  user: { phone?: string }
  sms: { otp: string }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 })
  }

  const secretsRaw = Deno.env.get("SEND_SMS_HOOK_SECRETS") ?? Deno.env.get("SEND_SMS_HOOK_SECRET") ?? ""
  if (!secretsRaw) {
    console.error("[send-sms-hook] Missing SEND_SMS_HOOK_SECRETS")
    return new Response(JSON.stringify({ error: "Hook secrets not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }

  const secretKey = secretsRaw.replace(/^v1,whsec_/, "")
  const wh = new Webhook(secretKey)

  let user: SmsPayload["user"]
  let sms: SmsPayload["sms"]

  try {
    const payload = await req.text()
    const headers = Object.fromEntries(req.headers)
    const verified = wh.verify(payload, headers) as SmsPayload
    user = verified.user
    sms = verified.sms
  } catch (e) {
    console.error("[send-sms-hook] verify failed:", e)
    return new Response(JSON.stringify({ error: "Invalid webhook" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
  }

  const logOtp = Deno.env.get("SMS_DEV_LOG_OTP") === "true"
  if (logOtp) {
    console.log(`[send-sms-hook][DEV] OTP for ${user?.phone ?? "?"}: ${sms.otp}`)
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
})
