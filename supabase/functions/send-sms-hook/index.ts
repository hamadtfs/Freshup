/**
 * Send SMS Auth Hook — Supabase Auth POSTs here instead of its built-in SMS sender
 * when Dashboard → Authentication → Hooks → Send SMS is enabled.
 *
 * This MUST send via Twilio. Returning 200 without a Twilio Message SID makes Auth
 * treat the OTP as sent while no SMS goes out (the previous bug).
 *
 * Secrets (Dashboard → Edge Functions → send-sms-hook, or `supabase secrets set`):
 *   SEND_SMS_HOOK_SECRETS / SEND_SMS_HOOK_SECRET  — webhook verify (v1,whsec_…)
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_MESSAGING_SERVICE_SID  (preferred) and/or TWILIO_PHONE_NUMBER
 *   SMS_DEV_LOG_OTP=true          — logs OTP to function logs; still requires Twilio
 *                                   (must never 200 without a Message SID)
 */
import { Webhook } from "npm:standardwebhooks@1.0.0";

type SmsPayload = {
  user: { phone?: string };
  sms: { otp: string };
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return "***";
  return `+${digits.slice(0, 2)}••••${digits.slice(-4)}`;
}

function countryHint(phone: string): string {
  if (phone.startsWith("+47")) return "NO";
  if (phone.startsWith("+")) return phone.slice(0, 3);
  return "unknown";
}

async function sendTwilioSms(to: string, body: string): Promise<{
  ok: boolean;
  sid?: string;
  status?: string;
  error_code?: number | string | null;
  error_message?: string | null;
  http_status: number;
}> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
  const messagingServiceSid =
    Deno.env.get("TWILIO_MESSAGING_SERVICE_SID") ??
    Deno.env.get("TWILIO_MESSAGE_SERVICE_SID") ??
    "";
  const fromNumber =
    Deno.env.get("TWILIO_PHONE_NUMBER") ??
    Deno.env.get("TWILIO_FROM_NUMBER") ??
    "";

  if (!accountSid || !authToken) {
    return {
      ok: false,
      http_status: 500,
      error_message: "TWILIO_NOT_CONFIGURED",
    };
  }
  if (!messagingServiceSid && !fromNumber) {
    return {
      ok: false,
      http_status: 500,
      error_message: "TWILIO_FROM_MISSING",
    };
  }

  const params = new URLSearchParams();
  params.set("To", to);
  params.set("Body", body);
  if (messagingServiceSid) {
    params.set("MessagingServiceSid", messagingServiceSid);
  } else {
    params.set("From", fromNumber);
  }

  const auth = btoa(`${accountSid}:${authToken}`);
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    },
  );
  const data = (await res.json().catch(() => ({}))) as {
    sid?: string;
    status?: string;
    code?: number;
    message?: string;
    error_code?: number | null;
    error_message?: string | null;
  };

  const queued = res.ok && (data.status === "queued" || data.status === "sent" ||
    data.status === "accepted");
  return {
    ok: queued,
    sid: data.sid,
    status: data.status,
    error_code: data.error_code ?? data.code ?? null,
    error_message: data.error_message ?? data.message ?? null,
    http_status: res.status,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const secretsRaw =
    Deno.env.get("SEND_SMS_HOOK_SECRETS") ??
    Deno.env.get("SEND_SMS_HOOK_SECRET") ??
    "";
  if (!secretsRaw) {
    console.error("[send-sms-hook] Missing SEND_SMS_HOOK_SECRETS");
    return json(500, { error: "Hook secrets not configured" });
  }

  const secretKey = secretsRaw.replace(/^v1,whsec_/, "");
  const wh = new Webhook(secretKey);

  let user: SmsPayload["user"];
  let sms: SmsPayload["sms"];

  try {
    const payload = await req.text();
    const headers = Object.fromEntries(req.headers);
    const verified = wh.verify(payload, headers) as SmsPayload;
    user = verified.user;
    sms = verified.sms;
  } catch (e) {
    console.error("[send-sms-hook] verify failed:", e);
    return json(401, { error: "Invalid webhook" });
  }

  const phone = String(user?.phone ?? "").trim();
  const otp = String(sms?.otp ?? "").trim();
  if (!phone || !otp) {
    console.error("[send-sms-hook] missing phone or otp");
    return json(400, { error: "Missing phone or otp" });
  }

  const logOtp = Deno.env.get("SMS_DEV_LOG_OTP") === "true";
  if (logOtp) {
    console.log(`[send-sms-hook][DEV] OTP for ${maskPhone(phone)}: ${otp}`);
  }

  // Never 200 without a Twilio Message SID. Auth treats 200 as "SMS sent" and
  // the app advances to the code screen even when nothing was delivered.
  const result = await sendTwilioSms(
    phone,
    `Your Fresh Up code is ${otp}`,
  );

  console.log(
    JSON.stringify({
      msg: "send-sms-hook twilio",
      to: maskPhone(phone),
      cc: countryHint(phone),
      ok: result.ok,
      sid: result.sid ?? null,
      twilio_status: result.status ?? null,
      error_code: result.error_code ?? null,
      error_message: result.error_message ?? null,
      http_status: result.http_status,
    }),
  );

  if (!result.ok) {
    return json(500, {
      error: {
        http_code: result.http_status || 500,
        message: result.error_message || "Failed to send SMS",
      },
    });
  }

  return json(200, {});
});
