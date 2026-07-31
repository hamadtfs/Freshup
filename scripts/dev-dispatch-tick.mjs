const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
const secret = process.env.DISPATCH_TICK_SECRET || "";

if (!secret) {
  console.error("Missing DISPATCH_TICK_SECRET in environment.");
  process.exit(1);
}

const tickUrl = `${String(baseUrl).replace(/\/+$/, "")}/api/orders/dispatch_tick?detail=1`;

async function tickOnce() {
  const started = Date.now();
  const res = await fetch(tickUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-dispatch-secret": secret,
    },
    body: "{}",
  });
  const text = await res.text();
  const ms = Date.now() - started;

  if (!res.ok) {
    console.error(`[tick] ${res.status} in ${ms}ms: ${text}`);
    return;
  }

  try {
    const json = JSON.parse(text);
    const processed = json?.processed ?? null;
    const summary = Array.isArray(json?.results)
      ? json.results.reduce((acc, r) => {
          const k = String(r?.action || "unknown");
          acc[k] = (acc[k] || 0) + 1;
          return acc;
        }, {})
      : null;
    const details = Array.isArray(json?.results)
      ? json.results
          .map((r) => {
            const action = String(r?.action || "unknown");
            const wave = r?.wave_name ? ` | ${String(r.wave_name)}` : "";
            const sent =
              typeof r?.offers_sent === "number" ? ` | offers=${r.offers_sent}` : "";
            return `${action}${wave}${sent}`;
          })
          .join("; ")
      : "";
    console.log(`[tick] ok in ${ms}ms processed=${processed}`, summary || "");
    if (details) console.log(`[tick] details: ${details}`);
  } catch {
    console.log(`[tick] ok in ${ms}ms: ${text.slice(0, 400)}`);
  }
}

console.log("Dispatch tick runner");
console.log("tickUrl:", tickUrl);
console.log("interval: 3s (Architecture §4.3 sub-waves)");

await tickOnce();
setInterval(() => {
  tickOnce().catch((e) => console.error("[tick] error:", e));
}, 3_000);
