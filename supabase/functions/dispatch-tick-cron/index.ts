// Supabase Edge Function: scheduled dispatch tick trigger.
// Calls the app's internal tick endpoint with a shared secret header.
//
// Required secrets (set in Supabase dashboard -> Edge Functions -> Secrets):
// - APP_BASE_URL (e.g. https://your-app.com)  (must be publicly reachable)
// - DISPATCH_TICK_SECRET (must match Next.js DISPATCH_TICK_SECRET)

Deno.serve(async (req) => {
  const started = Date.now();
  const appUrl = (Deno.env.get("APP_BASE_URL") || "").replace(/\/+$/, "");
  const secret = Deno.env.get("DISPATCH_TICK_SECRET") || "";
  const tickUrl = appUrl ? `${appUrl}/api/orders/dispatch_tick` : "";

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
  const preview = text.length > 2000 ? `${text.slice(0, 2000)}…` : text;

  return new Response(text, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "text/plain",
    },
  });
});

