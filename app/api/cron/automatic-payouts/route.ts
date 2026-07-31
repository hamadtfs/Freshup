import { createAdminClient } from "@/lib/supabase/server";
import { runAutomaticPayoutsForAllProviders } from "@/lib/payments/provider-payout";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();
    const result = await runAutomaticPayoutsForAllProviders(supabase);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[cron/automatic-payouts]", e);
    return NextResponse.json(
      { error: "Automatic payout run failed" },
      { status: 500 },
    );
  }
}
