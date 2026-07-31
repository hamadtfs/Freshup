import { createAdminClient } from "@/lib/supabase/server";
import { getUserIdFromBearer } from "@/lib/supabase/route-user";
import {
  formatNextPayoutLabel,
  getNextAutomaticPayoutDate,
  getProviderAvailableBalance,
  getProviderBankLast4,
  INSTANT_PAYOUT_FEE_NOK,
  maskBankAccount,
} from "@/lib/payments/provider-wallet";
import {
  formatTxDate,
  formatTxShortDate,
  formatTxTime,
} from "@/lib/payments/format-tx-datetime";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient();
    const providerId = await getUserIdFromBearer(supabase, req);
    if (!providerId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const language = req.nextUrl.searchParams.get("lang") === "en" ? "en" : "no";
    const nextPayoutAt = getNextAutomaticPayoutDate();

    const [availableBalance, bankLast4, { data: payouts }] = await Promise.all([
      getProviderAvailableBalance(supabase, providerId),
      getProviderBankLast4(supabase, providerId),
      supabase
        .from("payouts")
        .select("id, amount, fee, payout_type, status, created_at")
        .eq("provider_id", providerId)
        .order("created_at", { ascending: false })
        .limit(40),
    ]);

    const history = (payouts ?? []).map((p) => {
      const payoutType = String(p.payout_type || "automatic");
      const isInstant = payoutType === "instant";
      const fee = Number(p.fee) || 0;
      const createdAt = String(p.created_at || "");
      return {
        id: String(p.id),
        type: payoutType,
        amount: Number(p.amount) || 0,
        fee,
        status: String(p.status || "pending"),
        label: isInstant
          ? language === "en"
            ? "Instant payout"
            : "Umiddelbar utbetaling"
          : language === "en"
            ? "Automatic payout"
            : "Automatisk utbetaling",
        date: formatTxShortDate(createdAt, language),
        time: formatTxTime(createdAt),
        short_date: formatTxDate(createdAt, language),
      };
    });

    return NextResponse.json({
      available_balance: availableBalance,
      currency: "NOK",
      instant_payout_fee: INSTANT_PAYOUT_FEE_NOK,
      next_automatic_payout: {
        at: nextPayoutAt.toISOString(),
        label: formatNextPayoutLabel(nextPayoutAt, language),
      },
      bank_account: {
        last4: bankLast4,
        masked: maskBankAccount(bankLast4),
      },
      payout_history: history,
    });
  } catch (e) {
    console.error("[provider/wallet]", e);
    return NextResponse.json(
      { error: "Failed to load wallet" },
      { status: 500 },
    );
  }
}
