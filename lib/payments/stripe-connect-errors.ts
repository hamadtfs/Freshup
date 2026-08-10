/** Client-safe Stripe Connect signup error helpers (no Stripe SDK). */

export function stripeConnectStartUserMessage(
  codeOrMessage: string,
  isEn: boolean,
): string {
  const code = String(codeOrMessage || "").trim();
  if (
    code === "STRIPE_CONNECT_NOT_ENABLED" ||
    code.toLowerCase().includes("signed up for connect") ||
    code.toLowerCase().includes("dashboard.stripe.com/connect")
  ) {
    return isEn
      ? "Stripe Connect is not enabled on this Stripe account. In Stripe Dashboard → Connect, get started / activate Connect (use Test mode for development), then try again."
      : "Stripe Connect er ikke aktivert på denne Stripe-kontoen. Gå til Stripe Dashboard → Connect, aktiver Connect (bruk Test mode i utvikling), og prøv igjen.";
  }
  if (code === "STRIPE_NOT_CONFIGURED") {
    return isEn
      ? "Stripe is not configured on the server (missing STRIPE_SECRET_KEY)."
      : "Stripe er ikke konfigurert på serveren (mangler STRIPE_SECRET_KEY).";
  }
  return (
    code ||
    (isEn
      ? "Could not start Stripe Connect."
      : "Kunne ikke starte Stripe Connect.")
  );
}

export function isStripeConnectSetupError(codeOrMessage: string): boolean {
  const code = String(codeOrMessage || "");
  const lower = code.toLowerCase();
  return (
    code === "STRIPE_CONNECT_NOT_ENABLED" ||
    code === "STRIPE_NOT_CONFIGURED" ||
    lower.includes("signed up for connect") ||
    lower.includes("dashboard.stripe.com/connect") ||
    lower.includes("stripe connect is not enabled") ||
    lower.includes("stripe connect er ikke aktivert") ||
    lower.includes("missing stripe_secret_key")
  );
}

export function formatStripeConnectStartError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error || "");
  const lower = raw.toLowerCase();
  if (
    lower.includes("signed up for connect") ||
    lower.includes("dashboard.stripe.com/connect") ||
    (lower.includes("connect") && lower.includes("only create new accounts"))
  ) {
    return "STRIPE_CONNECT_NOT_ENABLED";
  }
  if (
    lower.includes("stripe_not_configured") ||
    raw === "STRIPE_NOT_CONFIGURED"
  ) {
    return "STRIPE_NOT_CONFIGURED";
  }
  return raw || "CONNECT_START_FAILED";
}
