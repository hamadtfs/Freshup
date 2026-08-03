// Supabase Edge Function: scheduled dispatch tick trigger.
// Calls the app's internal tick endpoint with a shared secret header.
//
// Required secrets (Supabase Dashboard → Edge Functions → Secrets):
// - APP_BASE_URL          public Next.js base URL (e.g. https://your-temp.vercel.app)
// - DISPATCH_TICK_SECRET  must match Next.js DISPATCH_TICK_SECRET
//
// Inbound auth: callers (pg_cron / invoke_dispatch_tick_cron) must send
//   x-dispatch-secret: <DISPATCH_TICK_SECRET>
// Deploy with JWT verification off — auth is the shared secret:
//   supabase functions deploy dispatch-tick-cron --no-verify-jwt

Deno.serve(async (req) => {
  const started = Date.now();
  const appUrl = (Deno.env.get("APP_BASE_URL") || "").replace(/\/+$/, "");
  const secret = Deno.env.get("DISPATCH_TICK_SECRET") || "";
  const tickUrl = appUrl ? `${appUrl}/api/orders/dispatch_tick` : "";

  const got =
    req.headers.get("x-dispatch-secret") ??
    req.headers.get("X-Dispatch-Secret") ??
    "";

  if (!secret || got !== secret) {
    console.error("[dispatch-tick-cron] unauthorized inbound");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }

  if (!appUrl || !secret) {
    console.error("[dispatch-tick-cron] missing env", {
      hasAppUrl: Boolean(appUrl),
      hasSecret: Boolean(secret),
    });
    return new Response("Missing APP_BASE_URL or DISPATCH_TICK_SECRET", {
      status: 500,
    });
  }

  let res: Response;
  try {
    res = await fetch(tickUrl, {
      method: "POST",
      headers: {
        "x-dispatch-secret": secret,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
  } catch (e) {
    console.error("[dispatch-tick-cron] fetch failed", {
      message: e instanceof Error ? e.message : String(e),
      tickUrl,
      ms: Date.now() - started,
    });
    return new Response(
      JSON.stringify({ error: "fetch_failed", detail: String(e) }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }

  const text = await res.text();

  return new Response(text, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "text/plain",
    },
  });
});
