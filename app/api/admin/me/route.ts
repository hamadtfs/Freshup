import { createAdminClient } from "@/lib/supabase/server";
import { getUserIdFromBearer } from "@/lib/supabase/route-user";
import { isAdminUserId } from "@/lib/payments/provider-eligibility";
import { NextRequest, NextResponse } from "next/server";

/** GET — whether the bearer user is an admin (ADMIN_USER_IDS). */
export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient();
    const userId = await getUserIdFromBearer(supabase, req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({
      is_admin: isAdminUserId(userId),
      user_id: userId,
    });
  } catch (e) {
    console.error("[admin/me]", e);
    return NextResponse.json({ error: "FAILED" }, { status: 500 });
  }
}
