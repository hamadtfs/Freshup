/**
 * UI labels for public.order_status (DB enum unchanged).
 * Product copy per M4 client spec.
 */

export type OrderStatusLanguage = "en" | "no";
export type OrderStatusAudience = "customer" | "provider";
export type OrderDeliveryMode = "home" | "at_provider";

const LABELS_EN: Record<string, string> = {
  pending: "Searching for provider",
  offered: "Searching for provider",
  assigned: "Provider accepted",
  en_route: "Provider on the way",
  arrived: "Provider arrived",
  in_progress: "Service in progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const LABELS_NO: Record<string, string> = {
  pending: "Søker etter tilbyder",
  offered: "Søker etter tilbyder",
  assigned: "Tilbyder har akseptert",
  en_route: "Tilbyder er på vei",
  arrived: "Tilbyder har ankommet",
  in_progress: "Tjeneste pågår",
  completed: "Fullført",
  cancelled: "Kansellert",
};

/** First-person copy for the provider's own job screen (not customer-facing). */
const PROVIDER_LABELS_EN: Record<string, string> = {
  assigned: "Request accepted",
  en_route: "You are on the way",
  arrived: "You have arrived",
  in_progress: "Service in progress",
  completed: "Completed",
};

const PROVIDER_LABELS_NO: Record<string, string> = {
  assigned: "Forespørsel akseptert",
  en_route: "Du er på vei",
  arrived: "Du har ankommet",
  in_progress: "Tjeneste pågår",
  completed: "Fullført",
};

/** Canonical DB status → customer-facing label (same for provider job list). */
export function formatDbOrderStatusLabel(
  status: string,
  language: OrderStatusLanguage = "no",
): string {
  const key = String(status || "").toLowerCase();
  const table = language === "en" ? LABELS_EN : LABELS_NO;
  return table[key] ?? status;
}

/** Customer matched / in-service sheet title from UI step or DB status. */
export function formatCustomerJobTitle(
  status: string,
  language: OrderStatusLanguage = "no",
): string {
  return formatDbOrderStatusLabel(status, language);
}

/** Map internal customer UI status to DB for label lookup. */
export function customerUiStatusToDbKey(
  uiStatus: string,
): string {
  switch (uiStatus) {
    case "searching":
      return "pending";
    case "enroute":
      return "en_route";
    case "in_service":
      return "in_progress";
    default:
      return uiStatus;
  }
}

export function formatCustomerJobTitleFromUi(
  uiStatus: string,
  language: OrderStatusLanguage = "no",
  deliveryMode: OrderDeliveryMode = "home",
): string {
  const dbKey = customerUiStatusToDbKey(uiStatus);
  if (dbKey === "arrived" && deliveryMode === "at_provider") {
    return language === "en" ? "You have arrived" : "Du har ankommet";
  }
  return formatDbOrderStatusLabel(dbKey, language);
}

/** Provider in-app job step → M4 status copy (DB enum unchanged). */
export function providerJobStepToDbKey(step: string): string {
  switch (step) {
    case "accepted":
      return "assigned";
    case "enroute":
      return "en_route";
    case "in_service":
      return "in_progress";
    case "completed":
      return "completed";
    default:
      return step;
  }
}

export function formatProviderJobStepTitle(
  step: string,
  language: OrderStatusLanguage = "no",
  opts?: {
    servicePaused?: boolean;
    deliveryMode?: OrderDeliveryMode;
  },
): string {
  if (opts?.servicePaused && step === "in_service") {
    return language === "en" ? "Service paused" : "Tjeneste pauset";
  }
  if (
    step === "arrived" &&
    opts?.deliveryMode === "at_provider"
  ) {
    return language === "en" ? "Customer arrived" : "Kunde har ankommet";
  }
  const dbKey = providerJobStepToDbKey(step);
  const table = language === "en" ? PROVIDER_LABELS_EN : PROVIDER_LABELS_NO;
  return table[dbKey] ?? formatDbOrderStatusLabel(dbKey, language);
}

const UPCOMING_DB = new Set([
  "pending",
  "offered",
  "assigned",
  "en_route",
  "arrived",
  "in_progress",
]);

export function orderListBucket(
  status: string,
): "upcoming" | "completed" | "cancelled" {
  const key = String(status || "").toLowerCase();
  if (key === "cancelled") return "cancelled";
  if (key === "completed") return "completed";
  if (UPCOMING_DB.has(key)) return "upcoming";
  return "completed";
}
