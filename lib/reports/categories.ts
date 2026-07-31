/** Categories accepted by POST /api/reports */
export const PROVIDER_REPORT_CATEGORIES = [
  "inappropriate_behavior",
  "no_show",
  "poor_service",
  "safety",
  "fraud",
  "other",
] as const

export type ProviderReportCategory = (typeof PROVIDER_REPORT_CATEGORIES)[number]

export function isProviderReportCategory(
  value: unknown,
): value is ProviderReportCategory {
  return (
    typeof value === "string" &&
    (PROVIDER_REPORT_CATEGORIES as readonly string[]).includes(value)
  )
}

export function providerReportCategoryLabel(
  category: ProviderReportCategory,
  language: "no" | "en" = "no",
): string {
  const isEn = language === "en"
  switch (category) {
    case "inappropriate_behavior":
      return isEn ? "Inappropriate behavior" : "Upassende oppførsel"
    case "no_show":
      return isEn ? "No-show / late" : "Ikke møtt / forsinket"
    case "poor_service":
      return isEn ? "Poor service quality" : "Dårlig servicekvalitet"
    case "safety":
      return isEn ? "Safety concern" : "Sikkerhetsbekymring"
    case "fraud":
      return isEn ? "Fraud / scam" : "Svindel"
    case "other":
      return isEn ? "Other" : "Annet"
    default:
      return category
  }
}
