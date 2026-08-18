import { createAdminClient } from "@/lib/supabase/server";
import { getUserIdFromBearer } from "@/lib/supabase/route-user";
import {
  anonymizeAccount,
  OpenOrdersError,
} from "@/lib/account/anonymize-account";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST — in-app account deletion (App Store 5.1.1(v)).
 * Removes / anonymises personal data. Orders, payments and payouts are kept
 * for accounting and audit. The auth user is banned, not hard-deleted
 * (hard-delete would CASCADE-wipe customer orders). Google / Apple / phone
 * identities are unlinked so the same login can create a new account.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient();
    const userId = await getUserIdFromBearer(supabase, req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await anonymizeAccount(supabase, userId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof OpenOrdersError) {
      return NextResponse.json({ error: "OPEN_ORDERS" }, { status: 409 });
    }
    console.error("[account/delete]", e);
    return NextResponse.json({ error: "FAILED" }, { status: 500 });
  }
}
