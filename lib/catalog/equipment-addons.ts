/** Add-ons that need salon equipment (basin, etc.) — home visit may vary. */
const EQUIPMENT_DEPENDENT_ADDON_IDS = new Set([
  "hair-wash",
  "hair-wash-b",
  "hair-wash-f",
  "scalp-treatment",
  "scalp-treatment-f",
]);

export function isEquipmentDependentAddon(addonId: string): boolean {
  const id = String(addonId || "")
    .trim()
    .toLowerCase();
  if (!id) return false;
  if (EQUIPMENT_DEPENDENT_ADDON_IDS.has(id)) return true;
  return id.includes("wash") || id.includes("scalp") || id.includes("basin");
}
