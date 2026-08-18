import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripe, isStripeConfigured } from "@/lib/payments/stripe";

const OPEN_JOB_STATUSES = [
  "pending",
  "offered",
  "accepted",
  "assigned",
  "en_route",
  "arrived",
  "in_progress",
] as const;

function missingRelation(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  const msg = error.message || "";
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    error.code === "PGRST204" ||
    /does not exist|schema cache|could not find/i.test(msg)
  );
}

async function safeDelete(
  supabase: SupabaseClient,
  table: string,
  column: string,
  userId: string,
) {
  const { error } = await supabase.from(table).delete().eq(column, userId);
  if (error && !missingRelation(error)) {
    console.warn(`[account/delete] ${table}:`, error.message);
  }
}

async function safeUpdate(
  supabase: SupabaseClient,
  table: string,
  values: Record<string, unknown>,
  column: string,
  userId: string,
) {
  const { error } = await supabase.from(table).update(values).eq(column, userId);
  if (error && !missingRelation(error)) {
    console.warn(`[account/delete] update ${table}:`, error.message);
  }
}

export class OpenOrdersError extends Error {
  constructor() {
    super("OPEN_ORDERS");
    this.name = "OpenOrdersError";
  }
}

/**
 * Anonymise a user in place. Orders / payments / payouts stay (accounting).
 * Do not delete auth.users — that CASCADE-deletes customer orders.
 * Login identities (Google / Apple / phone) must be unlinked so the same
 * Gmail or phone can sign up again; otherwise Auth signs into the banned user.
 */
export async function anonymizeAccount(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data: openJobs, error: openErr } = await supabase
    .from("orders")
    .select("id")
    .or(`customer_id.eq.${userId},provider_id.eq.${userId}`)
    .in("status", [...OPEN_JOB_STATUSES])
    .limit(1);
  if (openErr && !missingRelation(openErr)) {
    throw openErr;
  }
  if (openJobs && openJobs.length > 0) {
    throw new OpenOrdersError();
  }

  await supabase
    .from("provider_details")
    .update({ is_online: false, updated_at: new Date().toISOString() })
    .eq("id", userId);

  const { data: customer } = await supabase
    .from("customer_details")
    .select("stripe_customer_id")
    .eq("id", userId)
    .maybeSingle();
  const stripeCustomerId = String(customer?.stripe_customer_id || "").trim();

  if (isStripeConfigured() && stripeCustomerId) {
    try {
      const stripe = getStripe();
      const methods = await stripe.paymentMethods.list({
        customer: stripeCustomerId,
      });
      for (const pm of methods.data) {
        try {
          await stripe.paymentMethods.detach(pm.id);
        } catch {
          /* ignore */
        }
      }
      await stripe.customers.del(stripeCustomerId);
    } catch (e) {
      console.warn("[account/delete] stripe customer:", e);
    }
  }

  await safeDelete(supabase, "payment_methods", "customer_id", userId);
  await safeDelete(supabase, "push_tokens", "user_id", userId);
  await safeDelete(supabase, "customer_realtime_locations", "customer_id", userId);
  await safeDelete(supabase, "provider_realtime_locations", "provider_id", userId);
  await safeDelete(supabase, "provider_skills", "provider_id", userId);
  await safeDelete(supabase, "provider_modes", "provider_id", userId);
  await safeDelete(supabase, "provider_targets", "provider_id", userId);
  await safeDelete(supabase, "provider_categories", "provider_id", userId);
  await safeDelete(supabase, "provider_price_inputs", "provider_id", userId);
  await safeDelete(supabase, "provider_verifications", "provider_id", userId);

  const { error: msgErr } = await supabase
    .from("messages")
    .update({ body: "" })
    .eq("sender_id", userId);
  if (msgErr && !missingRelation(msgErr)) {
    console.warn("[account/delete] messages:", msgErr.message);
  }

  await safeDelete(supabase, "support_ticket_events", "actor_id", userId);
  await safeDelete(supabase, "support_tickets", "user_id", userId);

  const { error: reportErr } = await supabase
    .from("provider_reports")
    .update({ description: null })
    .eq("reporter_id", userId);
  if (reportErr && !missingRelation(reportErr)) {
    console.warn("[account/delete] reports:", reportErr.message);
  }

  const { error: ratingErr } = await supabase
    .from("ratings")
    .update({ comment: null })
    .or(`rater_id.eq.${userId},ratee_id.eq.${userId}`);
  if (ratingErr && !missingRelation(ratingErr)) {
    console.warn("[account/delete] ratings:", ratingErr.message);
  }

  const now = new Date().toISOString();
  await safeUpdate(
    supabase,
    "orders",
    {
      notes: null,
      customer_address: null,
      updated_at: now,
    },
    "customer_id",
    userId,
  );

  await supabase
    .from("profiles")
    .update({
      display_name: "Deleted user",
      phone: null,
      email: null,
      avatar_url: null,
      default_location_label: null,
      notification_opt_in: false,
      is_active: false,
      updated_at: now,
    })
    .eq("id", userId);

  await supabase.from("customer_details").update({
    full_name: null,
    phone: null,
    stripe_customer_id: null,
    updated_at: now,
  }).eq("id", userId);

  await supabase.from("provider_details").update({
    business_name: "Deleted provider",
    description: null,
    phone: null,
    email: null,
    avatar_url: null,
    address: null,
    lat: null,
    lng: null,
    is_online: false,
    bank_account_last4: null,
    stripe_onboarded: false,
    updated_at: now,
  }).eq("id", userId);

  await supabase
    .from("account_role_grants")
    .update({ status: "suspended", updated_at: now })
    .eq("user_id", userId);

  // Unlink Google / Apple / phone *before* the ban. Auth otherwise keeps the
  // identity on the banned user and the next login returns "user is banned".
  await unlinkLoginIdentities(supabase, userId);

  const tombstoneEmail = `deleted-${userId.replace(/-/g, "")}@deleted.invalid`;
  const { data: existing } = await supabase.auth.admin.getUserById(userId);
  const prevApp = (existing?.user?.app_metadata ?? {}) as Record<string, unknown>;
  const banned = await supabase.auth.admin.updateUserById(userId, {
    email: tombstoneEmail,
    email_confirm: true,
    ban_duration: "876000h",
    user_metadata: {
      deleted: true,
      app_role: null,
      full_name: "",
      name: "",
      display_name: "Deleted user",
      avatar_url: "",
      picture: "",
    },
    app_metadata: {
      ...prevApp,
      deleted: true,
      app_role: null,
      active_role: null,
    },
  });
  if (banned.error) {
    const retry = await supabase.auth.admin.updateUserById(userId, {
      email: tombstoneEmail,
      email_confirm: true,
      user_metadata: { deleted: true, full_name: "", name: "", avatar_url: "" },
      app_metadata: { ...prevApp, deleted: true },
    });
    if (retry.error) {
      console.warn("[account/delete] auth update:", retry.error.message);
    }
  }

  await unlinkLoginIdentities(supabase, userId);

  try {
    await supabase.auth.admin.signOut(userId, "global");
  } catch {
    /* older auth admin APIs omit signOut */
  }
}

/** Drop OAuth / phone identities so the same login can create a new user. */
async function unlinkLoginIdentities(
  supabase: SupabaseClient,
  userId: string,
) {
  const { error: rpcErr } = await supabase.rpc(
    "unlink_deleted_user_login_identities",
    { p_user_id: userId },
  );
  if (rpcErr && !missingRelation(rpcErr)) {
    console.warn("[account/delete] unlink rpc:", rpcErr.message);
  }

  const { data } = await supabase.auth.admin.getUserById(userId);
  const identities = data?.user?.identities ?? [];
  const authUrl = (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ""
  ).replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  for (const identity of identities) {
    const provider = String(identity.provider || "");
    if (provider === "email") continue;
    const candidates = [
      (identity as { identity_id?: string }).identity_id,
      identity.id,
    ]
      .map((v) => String(v || "").trim())
      .filter(Boolean);

    let unlinked = false;
    for (const identityId of candidates) {
      const { error } = await supabase.auth.admin.deleteUserIdentity(
        userId,
        identityId,
      );
      if (!error) {
        unlinked = true;
        break;
      }
      if (authUrl && serviceKey) {
        const res = await fetch(
          `${authUrl}/auth/v1/admin/users/${userId}/identities/${identityId}`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${serviceKey}`,
              apikey: serviceKey,
            },
          },
        );
        if (res.ok || res.status === 404) {
          unlinked = true;
          break;
        }
        console.warn(
          `[account/delete] unlink ${provider} identity:`,
          res.status,
          await res.text().catch(() => ""),
        );
      } else {
        console.warn(
          `[account/delete] unlink ${provider} identity:`,
          error.message,
        );
      }
    }
    if (!unlinked) {
      console.warn(
        `[account/delete] still linked ${provider} identity for ${userId}`,
      );
    }
  }

  if (data?.user?.phone) {
    const { error } = await supabase.auth.admin.updateUserById(userId, {
      phone: "",
    });
    if (error) {
      console.warn("[account/delete] clear phone:", error.message);
    }
  }
}
