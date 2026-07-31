import type { SupabaseClient } from "@supabase/supabase-js";

function roundKr(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Sum customer-facing add-on prices stored on the order snapshot. */
export async function sumOrderAddonsCustomerTotal(
  supabase: SupabaseClient,
  orderId: string,
): Promise<number> {
  const { data } = await supabase
    .from("order_addons")
    .select("unit_price, quantity")
    .eq("order_id", orderId);

  let sum = 0;
  for (const row of data ?? []) {
    const qty = Math.max(1, Number(row.quantity) || 1);
    sum += Math.round(Number(row.unit_price) || 0) * qty;
  }
  return roundKr(sum);
}

export function resolveAddonsCustomerTotal(
  lockAddonsCustomerTotal: number | null | undefined,
  orderAddonsCustomerTotal: number,
): number {
  const fromLock = roundKr(Number(lockAddonsCustomerTotal) || 0);
  if (fromLock > 0) return fromLock;
  return roundKr(orderAddonsCustomerTotal);
}
