import type { SupabaseClient } from "@supabase/supabase-js";

export type ProviderConnectStatus = {
  stripe_account_id: string | null;
  stripe_charges_enabled: boolean;
  stripe_payouts_enabled: boolean;
  stripe_onboarded: boolean;
  admin_approved: boolean;
  verification_status: "pending" | "approved" | "rejected" | null;
  can_go_online: boolean;
  block_reason: "PAYOUT_SETUP_REQUIRED" | "ADMIN_PENDING" | null;
};

type ProviderFlagsRow = {
  stripe_account_id?: string | null;
  stripe_charges_enabled?: boolean | null;
  stripe_payouts_enabled?: boolean | null;
  stripe_onboarded?: boolean | null;
  admin_approved?: boolean | null;
};

/** Local yarn dev: allow skill online without Stripe Connect / admin approval. */
export function isProviderOnlineGateRelaxed(): boolean {
  return process.env.NODE_ENV === "development";
}

export function computeCanGoOnline(flags: {
  stripe_payouts_enabled: boolean;
  admin_approved: boolean;
}): {
  can_go_online: boolean;
  block_reason: ProviderConnectStatus["block_reason"];
} {
  if (isProviderOnlineGateRelaxed()) {
    return { can_go_online: true, block_reason: null };
  }
  if (!flags.stripe_payouts_enabled) {
    return { can_go_online: false, block_reason: "PAYOUT_SETUP_REQUIRED" };
  }
  if (!flags.admin_approved) {
    return { can_go_online: false, block_reason: "ADMIN_PENDING" };
  }
  return { can_go_online: true, block_reason: null };
}

export async function loadProviderConnectStatus(
  supabase: SupabaseClient,
  providerId: string,
): Promise<ProviderConnectStatus | null> {
  const { data: provider, error } = await supabase
    .from("provider_details")
    .select(
      "stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_onboarded, admin_approved",
    )
    .eq("id", providerId)
    .maybeSingle();

  if (error || !provider) return null;

  const charges = Boolean(provider.stripe_charges_enabled);
  const payouts = Boolean(provider.stripe_payouts_enabled);
  const adminApproved = Boolean(provider.admin_approved);
  const { can_go_online, block_reason } = computeCanGoOnline({
    stripe_payouts_enabled: payouts,
    admin_approved: adminApproved,
  });

  const { data: verification } = await supabase
    .from("provider_verifications")
    .select("status")
    .eq("provider_id", providerId)
    .maybeSingle();

  const rawStatus = String(verification?.status || "").toLowerCase();
  const verification_status =
    rawStatus === "approved" || rawStatus === "rejected" || rawStatus === "pending"
      ? (rawStatus as "pending" | "approved" | "rejected")
      : null;

  return {
    stripe_account_id: provider.stripe_account_id
      ? String(provider.stripe_account_id)
      : null,
    stripe_charges_enabled: charges,
    stripe_payouts_enabled: payouts,
    stripe_onboarded: Boolean(provider.stripe_onboarded) || (charges && payouts),
    admin_approved: adminApproved,
    verification_status,
    can_go_online,
    block_reason,
  };
}

export function assertCanGoOnlineFromRow(row: ProviderFlagsRow): {
  ok: boolean;
  error?: "PAYOUT_SETUP_REQUIRED" | "ADMIN_PENDING";
} {
  const { can_go_online, block_reason } = computeCanGoOnline({
    stripe_payouts_enabled: Boolean(row.stripe_payouts_enabled),
    admin_approved: Boolean(row.admin_approved),
  });
  if (can_go_online) return { ok: true };
  return { ok: false, error: block_reason ?? "PAYOUT_SETUP_REQUIRED" };
}

export async function forceProviderOffline(
  supabase: SupabaseClient,
  providerId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await supabase
    .from("provider_skills")
    .update({ available_now: false, updated_at: now })
    .eq("provider_id", providerId);
  await supabase
    .from("provider_details")
    .update({ is_online: false, updated_at: now })
    .eq("id", providerId);
}

export function isAdminUserId(userId: string): boolean {
  const raw = process.env.ADMIN_USER_IDS || "";
  const allowed = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes(userId);
}
