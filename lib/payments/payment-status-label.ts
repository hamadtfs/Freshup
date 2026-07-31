export function paymentStatusLabel(
  status: string | null | undefined,
  language: "en" | "no",
): string {
  const key = String(status || "").toLowerCase();
  const en: Record<string, string> = {
    authorized: "Authorized",
    captured: "Charged",
    released: "Released",
    failed: "Failed",
    pending: "Pending",
    requires_capture: "Authorized",
    succeeded: "Charged",
    canceled: "Cancelled",
  };
  const no: Record<string, string> = {
    authorized: "Autorisert",
    captured: "Belastet",
    released: "Frigitt",
    failed: "Mislyktes",
    pending: "Venter",
    requires_capture: "Autorisert",
    succeeded: "Belastet",
    canceled: "Kansellert",
  };
  const table = language === "en" ? en : no;
  return table[key] || status || (language === "en" ? "Unknown" : "Ukjent");
}
