import { createAdminClient } from "@/lib/supabase/server";
import { withTransientRetry } from "@/lib/supabase/transient";
import { PAYMENT_PROBE_SERVICE_ID } from "@/lib/pricing/payment-probe";
import { NextRequest, NextResponse } from "next/server";

function normalizeServiceName(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isUuidLike(value: unknown): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim(),
  );
}

function serviceRowQualityScore(row: any): number {
  let score = 0;
  const id = String(row?.id || "").trim();
  const categoryId = String(row?.category_id || "").trim();
  if (id && !isUuidLike(id)) score += 3;
  if (categoryId.includes("_")) score += 2;
  if (Number.isFinite(Number(row?.base_price_max))) score += 1;
  if (Number.isFinite(Number(row?.duration_minutes))) score += 1;
  return score;
}

function dedupeKeyForService(row: any): string {
  const nameKey = normalizeServiceName(row?.name);
  const mode = String(row?.mode_id || "")
    .trim()
    .toLowerCase();
  const tgt = String(row?.target_id || "")
    .trim()
    .toLowerCase();
  const cat = String(row?.category_id || "")
    .trim()
    .toLowerCase();
  // Scope name collisions to mode+target+category so unrelated rows never
  // steal each other's slot (and duplicate imports with the same display name
  // in one category still collapse to one row).
  if (nameKey) return `n:${nameKey}|${mode}|${tgt}|${cat}`;
  const idKey = String(row?.id || "")
    .trim()
    .toLowerCase()
    .replace(/[-_]/g, "");
  if (!idKey) return "";
  return `i:${idKey}`;
}

function dedupeServices(rows: any[]): any[] {
  const byKey = new Map<string, any>();
  for (const row of rows || []) {
    const dedupeKey = dedupeKeyForService(row);
    if (!dedupeKey) continue;
    const existing = byKey.get(dedupeKey);
    if (!existing) {
      byKey.set(dedupeKey, row);
      continue;
    }
    if (serviceRowQualityScore(row) > serviceRowQualityScore(existing)) {
      byKey.set(dedupeKey, row);
    }
  }
  return Array.from(byKey.values());
}

export async function GET(req: NextRequest) {
  try {
    return await withTransientRetry(async () => {
      const supabase = createAdminClient();

      const { searchParams } = new URL(req.url);
      const includeProbe =
        searchParams.get("include_probe") === "1" ||
        searchParams.get("include_probe") === "true";
      // Internal payment probe service used for live Stripe end-to-end testing.
      // Hidden from normal catalog unless `include_probe=1`.
      const hierarchy = searchParams.get("hierarchy");
      const mode = searchParams.get("mode");
      const target = searchParams.get("target");
      const category = searchParams.get("category");

      // Full DB-backed hierarchy (modes -> targets -> categories -> services)
      // DB columns: modes/targets/categories use `label`; services uses `name`.
      // Map `label` -> `name` in the response so the client shape is unchanged.
      if (hierarchy === "1" || hierarchy === "true") {
        // NOTE: `modes`, `targets`, and `categories` store their display text in
        // `label` (not `name`). We select `label` and remap to `name` in JS so
        // existing client code (e.g. app/page.tsx MODE_TARGETS) that expects
        // `t.name` keeps working without any changes. `services` already has a
        // real `name` column.

        const [
          { data: modes, error: modesErr },
          { data: targets, error: targetsErr },
          { data: categories, error: categoriesErr },
          { data: services, error: servicesErr },
        ] = await Promise.all([
          supabase
            .from("modes")
            .select("id, label, icon, sort_order")
            .order("sort_order", { ascending: true })
            .order("id", { ascending: true }),
          supabase
            .from("targets")
            .select("id, mode_id, label, icon, sort_order")
            .order("sort_order", { ascending: true })
            .order("id", { ascending: true }),
          supabase
            .from("categories")
            .select("id, mode_id, target_id, label, icon, sort_order")
            .order("sort_order", { ascending: true })
            .order("id", { ascending: true }),
          supabase
            .from("services")
            .select(
              "id, mode_id, target_id, category_id, name, duration_minutes, base_price_min, base_price_max, is_active, sort_order",
            )
            .eq("is_active", true)
            .order("sort_order", { ascending: true })
            .order("id", { ascending: true }),
        ]);

        if (modesErr) throw modesErr;
        if (targetsErr) throw targetsErr;
        if (categoriesErr) throw categoriesErr;
        if (servicesErr) throw servicesErr;

        const filteredServices =
          includeProbe || !services
            ? services || []
            : (services || []).filter(
                (s) => String(s?.id || "") !== PAYMENT_PROBE_SERVICE_ID,
              );

        const labelToName = <
          T extends { label?: string | null; name?: string | null },
        >(
          row: T,
        ): T & { name: string } => ({
          ...row,
          name: String(row?.name ?? row?.label ?? "").trim(),
        });

        // Remap `label` → `name` so the response shape stays backward-compatible
        // with client code that already reads `t.name`, `c.name`, `m.name`.
        const remap = <T extends { label?: string | null }>(
          rows: T[] | null | undefined,
        ): Array<Omit<T, "label"> & { name: string | null }> =>
          (rows || []).map((row) => {
            const { label, ...rest } = row;
            return { ...rest, name: label ?? null } as Omit<T, "label"> & {
              name: string | null;
            };
          });

        return NextResponse.json({
          modes: remap(modes),
          targets: remap(targets),
          categories: remap(categories),
          services: filteredServices,
        });
      }

      // If no filters, return all modes
      if (!mode) {
        const { data: modes, error } = await supabase
          .from("modes")
          .select("*")
          .order("id", { ascending: true });

        if (error) throw error;
        return NextResponse.json({ modes });
      }

      // If mode only, return targets for that mode
      if (mode && !target) {
        const { data: targets, error } = await supabase
          .from("targets")
          .select("*")
          .eq("mode_id", mode)
          .order("id", { ascending: true });

        if (error) throw error;
        return NextResponse.json({ targets });
      }

      // If mode + target, return categories
      if (mode && target && !category) {
        const { data: categories, error } = await supabase
          .from("categories")
          .select("*")
          .eq("mode_id", mode)
          .eq("target_id", target)
          .order("id", { ascending: true });

        if (error) throw error;
        return NextResponse.json({ categories });
      }

      // If mode + target + category, return services
      if (mode && target && category) {
        const { data: services, error } = await supabase
          .from("services")
          .select("*")
          .eq("mode_id", mode)
          .eq("target_id", target)
          .eq("category_id", category)
          .eq("is_active", true)
          .order("id", { ascending: true });

        if (error) throw error;
        const normalizedTarget = String(target).trim();
        const normalizedCategory = String(category).trim();
        const targetIsCanonical = normalizedTarget.includes("_");
        const categoryIsCanonical = normalizedCategory.includes("_");
        const keepCanonicalShape = (rows: any[]) =>
          (rows || []).filter((row: any) => {
            const rowTarget = String(row?.target_id || "").trim();
            const rowCategory = String(row?.category_id || "").trim();
            const targetMatches = targetIsCanonical
              ? rowTarget === normalizedTarget
              : rowTarget.endsWith(`_${normalizedTarget}`);
            const categoryMatches = categoryIsCanonical
              ? rowCategory === normalizedCategory
              : rowCategory.endsWith(`_${normalizedCategory}`);
            return targetMatches && categoryMatches;
          });

        const candidateServices = includeProbe
          ? services || []
          : (services || []).filter(
              (s) => String(s?.id || "") !== PAYMENT_PROBE_SERVICE_ID,
            );

        const strictServices = keepCanonicalShape(candidateServices);
        if (strictServices.length > 0) {
          return NextResponse.json({
            services: dedupeServices(strictServices),
          });
        }

        // Backward-compatible fallback:
        // UI sometimes sends short ids (e.g. target=female, category=haircut)
        // while DB stores canonical ids (e.g. beauty_female, beauty_female_haircut).
        const { data: modeServices, error: modeServicesErr } = await supabase
          .from("services")
          .select("*")
          .eq("mode_id", mode)
          .eq("is_active", true)
          .order("id", { ascending: true });
        if (modeServicesErr) throw modeServicesErr;

        const compatibleServices = keepCanonicalShape(modeServices || []);

        return NextResponse.json({
          services: dedupeServices(compatibleServices),
        });
      }

      return NextResponse.json(
        { error: "Invalid parameters" },
        { status: 400 },
      );
    });
  } catch (error) {
    console.error("[v0] Services API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch services" },
      { status: 503 },
    );
  }
}
