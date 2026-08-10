import { createAdminClient } from "@/lib/supabase/server";
import { getUserIdFromBearer } from "@/lib/supabase/route-user";
import { isAdminUserId } from "@/lib/payments/provider-eligibility";
import { NextRequest, NextResponse } from "next/server";

async function requireAdmin(req: NextRequest): Promise<string | null> {
  const supabase = createAdminClient();
  const userId = await getUserIdFromBearer(supabase, req);
  if (!userId || !isAdminUserId(userId)) return null;
  return userId;
}

/**
 * GET — list providers pending admin approve (Stripe ready or awaiting).
 * Query: ?ready=1 → only Stripe payouts_enabled && !admin_approved
 */
export async function GET(req: NextRequest) {
  try {
    const adminId = await requireAdmin(req);
    if (!adminId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const supabase = createAdminClient();
    const readyOnly = req.nextUrl.searchParams.get("ready") === "1";

    let query = supabase
      .from("provider_details")
      .select(
        "id, business_name, phone, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_onboarded, admin_approved, created_at",
      )
      .eq("admin_approved", false)
      .order("created_at", { ascending: false })
      .limit(100);

    if (readyOnly) {
      query = query.eq("stripe_payouts_enabled", true);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({
      providers: data ?? [],
      count: (data ?? []).length,
    });
  } catch (e) {
    console.error("[admin/providers/verifications GET]", e);
    return NextResponse.json({ error: "FAILED" }, { status: 500 });
  }
}

/**
 * POST — approve or reject a provider for first-cohort gate.
 * Body: { provider_id, action: "approve" | "reject", notes? }
 */
export async function POST(req: NextRequest) {
  try {
    const adminId = await requireAdmin(req);
    if (!adminId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await req.json()) as {
      provider_id?: string;
      action?: string;
      notes?: string;
    };
    const providerId = String(body.provider_id || "").trim();
    const action = String(body.action || "").trim().toLowerCase();
    if (!providerId || (action !== "approve" && action !== "reject")) {
      return NextResponse.json(
        { error: "provider_id and action (approve|reject) required" },
        { status: 400 },
      );
    }

    const supabase = createAdminClient();
    const now = new Date().toISOString();
    const approved = action === "approve";

    const { error: pdErr } = await supabase
      .from("provider_details")
      .update({
        admin_approved: approved,
        updated_at: now,
      })
      .eq("id", providerId);
    if (pdErr) throw pdErr;

    const { error: verErr } = await supabase.from("provider_verifications").upsert(
      {
        provider_id: providerId,
        status: approved ? "approved" : "rejected",
        source: "admin",
        reviewed_by: adminId,
        reviewed_at: now,
        review_notes: body.notes?.trim() || (approved ? "Admin approved" : "Admin rejected"),
        updated_at: now,
      },
      { onConflict: "provider_id" },
    );
    if (verErr) {
      console.error("[admin/verifications] upsert", verErr);
    }

    if (!approved) {
      await supabase
        .from("provider_skills")
        .update({ available_now: false, updated_at: now })
        .eq("provider_id", providerId);
      await supabase
        .from("provider_details")
        .update({ is_online: false, updated_at: now })
        .eq("id", providerId);
      await supabase.rpc("upsert_account_role_grant", {
        p_user_id: providerId,
        p_role: "provider",
        p_status: "suspended",
        p_activate: false,
      });
    } else {
      await supabase.rpc("upsert_account_role_grant", {
        p_user_id: providerId,
        p_role: "provider",
        p_status: "active",
        p_activate: true,
      });
    }

    return NextResponse.json({
      ok: true,
      provider_id: providerId,
      admin_approved: approved,
      status: approved ? "approved" : "rejected",
    });
  } catch (e) {
    console.error("[admin/providers/verifications POST]", e);
    return NextResponse.json({ error: "FAILED" }, { status: 500 });
  }
}
