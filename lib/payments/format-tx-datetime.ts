export type DisplayLanguage = "en" | "no";

export function formatTxDate(
  iso: string | null | undefined,
  language: DisplayLanguage,
): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const startYesterday = new Date(startToday);
  startYesterday.setDate(startYesterday.getDate() - 1);
  if (d >= startToday) return language === "en" ? "Today" : "I dag";
  if (d >= startYesterday) return language === "en" ? "Yesterday" : "I går";
  return d.toLocaleDateString(language === "en" ? "en-GB" : "nb-NO", {
    day: "numeric",
    month: "short",
  });
}

export function formatTxTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
}

export function formatTxShortDate(
  iso: string | null | undefined,
  language: DisplayLanguage,
): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(language === "en" ? "en-GB" : "nb-NO", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}
