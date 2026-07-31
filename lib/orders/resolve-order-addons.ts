import type { SupabaseClient } from "@supabase/supabase-js";

export type OrderAddonSelection = {
  catalog_id: string;
  name: string;
  price: number;
  extra_minutes?: number;
};

export function normalizeAddonKey(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function catalogIdFromDescription(description: string | null | undefined): string {
  const match = String(description || "").match(/catalog_id:([a-z0-9-]+)/i);
  return match?.[1] ? normalizeAddonKey(match[1]) : "";
}

export function parseAddonSelections(body: unknown): OrderAddonSelection[] {
  const raw = (body as { addon_selections?: unknown })?.addon_selections;
  if (!Array.isArray(raw)) return [];

  const selections: OrderAddonSelection[] = [];
  for (const item of raw) {
    const catalog_id = String(
      (item as { catalog_id?: string; id?: string })?.catalog_id ??
        (item as { id?: string })?.id ??
        "",
    ).trim();
    const name = String((item as { name?: string })?.name ?? "").trim();
    const price = Math.round(Number((item as { price?: number })?.price) || 0);
    const extraMinutesRaw = Number(
      (item as { extra_minutes?: number; time?: number })?.extra_minutes ??
        (item as { time?: number })?.time,
    );
    if (!catalog_id || !name) continue;
    selections.push({
      catalog_id,
      name,
      price,
      extra_minutes:
        Number.isFinite(extraMinutesRaw) && extraMinutesRaw > 0
          ? Math.round(extraMinutesRaw)
          : undefined,
    });
  }
  return selections;
}

type DbAddonRow = {
  id: string;
  name: string;
  description: string | null;
  extra_price: number;
};

function selectionKeys(selection: OrderAddonSelection): Set<string> {
  const keys = new Set<string>();
  keys.add(normalizeAddonKey(selection.catalog_id));
  keys.add(normalizeAddonKey(selection.name));
  return keys;
}

function addonMatchesSelection(
  addon: DbAddonRow,
  wantedKeys: Set<string>,
): boolean {
  const dbName = normalizeAddonKey(addon.name);
  const dbId = normalizeAddonKey(addon.id);
  const catalogKey = catalogIdFromDescription(addon.description);
  if (wantedKeys.has(dbName) || wantedKeys.has(dbId)) return true;
  if (catalogKey && wantedKeys.has(catalogKey)) return true;
  return false;
}

/**
 * Maps UI catalog add-ons to `service_addons` row IDs, creating rows when missing
 * so every customer selection is persisted on the order.
 */
export async function resolveOrderAddonIds(
  supabase: SupabaseClient,
  serviceId: string,
  selections: OrderAddonSelection[],
): Promise<string[]> {
  if (!selections.length) return [];

  const { data: dbAddons, error } = await supabase
    .from("service_addons")
    .select("id, name, description, extra_price")
    .eq("service_id", serviceId)
    .eq("is_active", true);

  if (error) throw error;

  const pool = [...((dbAddons ?? []) as DbAddonRow[])];
  const resolvedIds: string[] = [];
  const usedIds = new Set<string>();

  for (const selection of selections) {
    const wantedKeys = selectionKeys(selection);
    let match = pool.find(
      (addon) => !usedIds.has(addon.id) && addonMatchesSelection(addon, wantedKeys),
    );

    if (!match) {
      const { data: inserted, error: insertErr } = await supabase
        .from("service_addons")
        .insert({
          service_id: serviceId,
          name: selection.name,
          description: `catalog_id:${selection.catalog_id}`,
          extra_price: Math.max(0, Math.round(Number(selection.price) || 0)),
          extra_minutes: Math.max(
            0,
            Math.round(Number(selection.extra_minutes) || 0),
          ),
          is_active: true,
        })
        .select("id, name, description, extra_price")
        .single();

      if (insertErr || !inserted?.id) throw insertErr ?? new Error("addon insert failed");

      match = inserted as DbAddonRow;
      pool.push(match);
    }

    if (!usedIds.has(match.id)) {
      usedIds.add(match.id);
      resolvedIds.push(match.id);
    }
  }

  return resolvedIds;
}
