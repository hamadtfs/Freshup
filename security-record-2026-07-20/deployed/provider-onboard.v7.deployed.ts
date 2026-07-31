/**
 * SECURITY: Temporarily disabled (2026-07-20).
 * Previous vulnerable implementation preserved at:
 *   security-record-2026-07-20/provider-onboard.index.ts.before-disable
 *
 * Do not accept x-provider-id or use the service role here.
 * Web onboarding uses Next.js POST /api/providers/onboard instead.
 */
Deno.serve((_req) => {
  return new Response(
    JSON.stringify({
      error: "provider-onboard edge function is temporarily disabled",
      code: "PROVIDER_ONBOARD_DISABLED",
    }),
    {
      status: 410,
      headers: { "Content-Type": "application/json" },
    },
  )
})
