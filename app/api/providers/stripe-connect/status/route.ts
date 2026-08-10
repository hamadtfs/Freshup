import { createAdminClient } from "@/lib/supabase/server";
import { getUserIdFromBearer } from "@/lib/supabase/route-user";
import { loadProviderConnectStatus } from "@/lib/payments/provider-eligibility";
import { retrieveAndSyncStripeAccount } from "@/lib/payments/stripe-connect";
import { isStripeConfigured } from "@/lib/payments/stripe";
import { NextRequest, NextResponse } from "next/server";

async function resolveProviderId(req: NextRequest): Promise<string | null> {
  const supabase = createAdminClient();
  const fromBearer = await getUserIdFromBearer(supabase, req);
  if (fromBearer) return fromBearer;
  const headerId = req.headers.get("x-provider-id");
  return headerId?.trim() || null;
}

/** GET — Connect + admin gate status for going online. */
export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient();
    const providerId = await resolveProviderId(req);
    if (!providerId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Optional live refresh from Stripe when returning from Account Link.
    const refresh = req.nextUrl.searchParams.get("refresh") === "1";
    if (refresh && isStripeConfigured()) {
      const { data: row } = await supabase
        .from("provider_details")
        .select("stripe_account_id")
        .eq("id", providerId)
        .maybeSingle();
      const accountId = String(row?.stripe_account_id || "").trim();
      if (accountId) {
        try {
          await retrieveAndSyncStripeAccount(supabase, accountId);
        } catch (e) {
          console.error("[stripe-connect/status] refresh failed", e);
        }
      }
    }

    const status = await loadProviderConnectStatus(supabase, providerId);
    if (!status) {
      return NextResponse.json(
        { error: "PROVIDER_NOT_FOUND" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ...status,
      stripe_configured: isStripeConfigured(),
    });
  } catch (e) {
    console.error("[stripe-connect/status]", e);
    return NextResponse.json(
      { error: "CONNECT_STATUS_FAILED" },
      { status: 500 },
    );
  }
}
