/**
 * Local dev: refresh demand_zones for Oslo bbox.
 * Usage: node --env-file=.env scripts/dev-refresh-demand-zones.mjs
 */
const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const secret = process.env.CRON_SECRET || "";

const res = await fetch(`${base}/api/cron/refresh-demand-zones`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    ...(secret ? { authorization: `Bearer ${secret}` } : {}),
  },
  body: JSON.stringify({}),
});

const text = await res.text();
console.log(res.status, text);
