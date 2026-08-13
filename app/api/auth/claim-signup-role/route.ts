import { createAdminClient } from "@/lib/supabase/server";
import { getUserIdFromBearer } from "@/lib/supabase/route-user";
import {
  grantAllowsAppAccess,
  listAccountRoleGrants,
  upsertAccountRoleGrant,
} from "@/lib/auth/account-role-grants";
import type { DashboardMode } from "@/lib/auth/dashboard-mode";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST — record the role the user actually chose at signup.
 * Provider → pending grant only (no customer grant / customer_details).
 * Customer → active grant only (customer_details waits until first booking).
 * Does not invent a second role — that happens via onboard / Book a service.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient();
    const userId = await getUserIdFromBearer(supabase, req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as { role?: string };
    const role: DashboardMode | null =
      body.role === "provider" || body.role === "customer" ? body.role : null;
    if (!role) {
      return NextResponse.json({ error: "role required" }, { status: 400 });
    }

    const grants = await listAccountRoleGrants(supabase, userId);
    const existingThis = grants.find((g) => g.role === role);
    const other = grants.find((g) => g.role !== role);

    // Never downgrade an active / suspended grant from a signup claim.
    if (
      existingThis?.status === "active" ||
      existingThis?.status === "suspended"
    ) {
      await syncRoleMetadata(supabase, userId, role);
      return NextResponse.json({
        ok: true,
        role,
        status: existingThis.status,
      });
    }

    // Second role is granted by onboard (provider) or ensure (customer), not here.
    if (other && grantAllowsAppAccess(other.status)) {
      return NextResponse.json({
        ok: true,
        role,
        status: existingThis?.status ?? null,
        skipped: true,
      });
    }

    const status = role === "provider" ? "pending" : "active";
    const grant = await upsertAccountRoleGrant(supabase, userId, role, status);
    if (!grant.ok) {
      return NextResponse.json(
        { error: grant.error || "grant_failed" },
        { status: 500 },
      );
    }

    await syncRoleMetadata(supabase, userId, role);
    return NextResponse.json({ ok: true, role, status });
  } catch (e) {
    console.error("[auth/claim-signup-role]", e);
    return NextResponse.json({ error: "FAILED" }, { status: 500 });
  }
}

async function syncRoleMetadata(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  role: DashboardMode,
) {
  const { data: existing } = await supabase.auth.admin.getUserById(userId);
  if (!existing?.user) return;
  const prevApp = (existing.user.app_metadata ?? {}) as Record<string, unknown>;
  const prevUser = (existing.user.user_metadata ?? {}) as Record<string, unknown>;
  await supabase.auth.admin.updateUserById(userId, {
    app_metadata: { ...prevApp, app_role: role, active_role: role },
    user_metadata: { ...prevUser, app_role: role },
  });
}
