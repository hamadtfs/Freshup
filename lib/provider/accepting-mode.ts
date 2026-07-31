/** Live accepting mode vs capability `delivery_modes`. */

export type AcceptingDeliveryMode = "home" | "at_provider" | "both";

export function normalizeAcceptingDeliveryMode(
  value: unknown,
): AcceptingDeliveryMode | null {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (raw === "home") return "home";
  if (raw === "at_provider" || raw === "provider") return "at_provider";
  if (raw === "both") return "both";
  return null;
}

/** UI / lock mode → stored accepting mode. */
export function acceptingModeFromUi(
  mode: "home" | "provider",
): AcceptingDeliveryMode {
  return mode === "home" ? "home" : "at_provider";
}

/**
 * Whether provider `delivery_modes` (active XOR list) allows this order mode.
 * Empty/null = legacy both.
 */
export function providerDeliveryModesAllowServiceMode(
  deliveryModes: unknown,
  serviceModeId: string,
): boolean {
  const list = Array.isArray(deliveryModes)
    ? deliveryModes
        .map((v) =>
          String(v || "")
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean)
    : [];
  if (list.length === 0) return true;
  const sm = String(serviceModeId || "")
    .trim()
    .toLowerCase();
  if (sm === "home") return list.includes("home");
  if (sm === "provider" || sm === "both") {
    return list.includes("at_provider") || list.includes("provider");
  }
  return false;
}

/**
 * Whether a provider's accepting mode allows this order service_mode_id
 * (`home` | `provider` | `both`). Prefer `providerDeliveryModesAllowServiceMode`
 * when `delivery_modes` is the source of truth.
 */
export function providerAcceptsServiceMode(
  accepting: string | null | undefined,
  serviceModeId: string,
): boolean {
  const a = normalizeAcceptingDeliveryMode(accepting) ?? "both";
  const sm = String(serviceModeId || "")
    .trim()
    .toLowerCase();
  if (a === "both") return true;
  if (sm === "home") return a === "home";
  if (sm === "provider" || sm === "both") return a === "at_provider";
  return false;
}
