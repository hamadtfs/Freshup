import { createAdminClient } from "@/lib/supabase/server";
import { getUserIdFromBearer } from "@/lib/supabase/route-user";
import { isStripeConfigured } from "@/lib/payments/stripe";
import {
  grantAllowsAppAccess,
  listAccountRoleGrants,
  upsertAccountRoleGrant,
} from "@/lib/auth/account-role-grants";
import {
  createStripeConnectAccountLink,
  ensureStripeConnectAccount,
  formatStripeConnectStartError,
  retrieveAndSyncStripeAccount,
} from "@/lib/payments/stripe-connect";
import { NextRequest, NextResponse } from "next/server";

async function resolveProviderId(req: NextRequest): Promise<string | null> {
  const supabase = createAdminClient();
  const fromBearer = await getUserIdFromBearer(supabase, req);
  if (fromBearer) return fromBearer;
  const headerId = req.headers.get("x-provider-id");
  return headerId?.trim() || null;
}

/** POST — create/reuse Connect Express account + return Account Link URL. */
export async function POST(req: NextRequest) {
  try {
    if (!isStripeConfigured()) {
      return NextResponse.json(
        { error: "STRIPE_NOT_CONFIGURED" },
        { status: 503 },
      );
    }

    const supabase = createAdminClient();
    const providerId = await resolveProviderId(req);
    if (!providerId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      return_url?: string;
      refresh_url?: string;
      email?: string;
      business_name?: string;
      phone?: string;
    };

    // Signup may call Connect before full onboard — ensure a stub row exists.
    const { data: provider, error: providerLookupErr } = await supabase
      .from("provider_details")
      .select("id")
      .eq("id", providerId)
      .maybeSingle();
    if (providerLookupErr) throw providerLookupErr;
    const grants = await listAccountRoleGrants(supabase, providerId);
    const alreadyCustomer = grants.some(
      (g) => g.role === "customer" && grantAllowsAppAccess(g.status),
    );
    // Fresh provider signup: record pending grant. Existing customers wait
    // until onboard completes so abandoning Connect is not dual-mode.
    if (!alreadyCustomer) {
      await upsertAccountRoleGrant(supabase, providerId, "provider", "pending");
    }

    if (!provider) {
      const now = new Date().toISOString();
      const { error: stubErr } = await supabase.from("provider_details").upsert(
        {
          id: providerId,
          business_name: body.business_name?.trim() || null,
          phone: body.phone?.trim() || null,
          is_online: false,
          updated_at: now,
          created_at: now,
        },
        { onConflict: "id" },
      );
      if (stubErr) {
        return NextResponse.json(
          {
            error: "PROVIDER_STUB_FAILED",
            message: stubErr.message,
          },
          { status: 500 },
        );
      }
    }

    const accountId = await ensureStripeConnectAccount(supabase, providerId, {
      email: body.email,
    });
    const url = await createStripeConnectAccountLink(accountId, {
      returnUrl: body.return_url,
      refreshUrl: body.refresh_url,
    });

    // Best-effort sync in case they already completed previously.
    try {
      await retrieveAndSyncStripeAccount(supabase, accountId);
    } catch {
      // ignore — webhook is source of truth
    }

    return NextResponse.json({
      ok: true,
      stripe_account_id: accountId,
      onboarding_url: url,
    });
  } catch (e) {
    const msg = formatStripeConnectStartError(e);
    console.error("[stripe-connect/start]", msg);
    return NextResponse.json(
      {
        error: msg || "CONNECT_START_FAILED",
        message: msg || "CONNECT_START_FAILED",
      },
      { status: 500 },
    );
  }
}
