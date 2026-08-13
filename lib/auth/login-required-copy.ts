/** API 401 / "Unauthorized" is not useful copy for guests. */

export function isUnauthorizedCopy(value: unknown, status?: number): boolean {
  if (status === 401) return true;
  const s = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!s) return false;
  return /unauthorized|unauthenticated|not authenticated|authentication required|auth required/.test(
    s,
  );
}

export function loginToBookCopy(isEn: boolean): string {
  return isEn ? "Please login to book" : "Logg inn for å bestille";
}

export function loginToContinueCopy(isEn: boolean): string {
  return isEn ? "Please login to continue" : "Logg inn for å fortsette";
}

export function mapAuthGateCopy(
  value: unknown,
  isEn: boolean,
  status?: number,
  kind: "book" | "continue" = "book",
): string {
  if (isUnauthorizedCopy(value, status)) {
    return kind === "continue"
      ? loginToContinueCopy(isEn)
      : loginToBookCopy(isEn);
  }
  return String(value ?? "").trim();
}
