import { createAdminClient } from "@/lib/supabase/server";
import { getUserIdFromBearer } from "@/lib/supabase/route-user";
import { createProviderPayout } from "@/lib/payments/provider-payout";
import {
  getProviderAvailableBalance,
  getProviderBankLast4,
  INSTANT_PAYOUT_FEE_NOK,
  maskBankAccount,
} from "@/lib/payments/provider-wallet";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient();
    const providerId = await getUserIdFromBearer(supabase, req);
    if (!providerId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const language = req.nextUrl.searchParams.get("lang") === "en" ? "en" : "no";
    const balance = await getProviderAvailableBalance(supabase, providerId);

    if (balance <= 0) {
      return NextResponse.json(
        {
          error:
            language === "en"
              ? "No available balance"
              : "Ingen tilgjengelig saldo",
        },
        { status: 400 },
      );
    }

    if (balance <= INSTANT_PAYOUT_FEE_NOK) {
      return NextResponse.json(
        {
          error:
            language === "en"
              ? "Balance is too low for instant payout"
              : "Saldoen er for lav for umiddelbar utbetaling",
        },
        { status: 400 },
      );
    }

    const result = await createProviderPayout(supabase, providerId, "instant");
    if (!result.ok || !result.payout) {
      return NextResponse.json(
        {
          error:
            language === "en"
              ? "Could not process payout"
              : "Kunne ikke gjennomføre utbetaling",
        },
        { status: 500 },
      );
    }

    const bankLast4 = await getProviderBankLast4(supabase, providerId);
    const newBalance = await getProviderAvailableBalance(supabase, providerId);
    const netAmount = result.payout.amount - result.payout.fee;

    return NextResponse.json({
      ok: true,
      payout: {
        id: result.payout.id,
        amount: result.payout.amount,
        fee: result.payout.fee,
        net_amount: netAmount,
        created_at: result.payout.created_at,
      },
      available_balance: newBalance,
      bank_account: maskBankAccount(bankLast4),
    });
  } catch (e) {
    console.error("[provider/wallet/instant-payout]", e);
    return NextResponse.json(
      { error: "Failed to process instant payout" },
      { status: 500 },
    );
  }
}
