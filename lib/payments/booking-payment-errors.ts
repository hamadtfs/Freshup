/** Map Stripe / API payment errors to customer-facing copy. */

export function bookingPaymentUserMessage(
  raw: unknown,
  isEn: boolean,
): string {
  const s = String(raw ?? "").trim();
  const lower = s.toLowerCase();

  if (
    /no such paymentmethod|resource_missing.*payment.?method|payment_method_not_found|pm_[a-z0-9]+.*(invalid|not found|does not exist)/i.test(
      s,
    ) ||
    (lower.includes("paymentmethod") &&
      (lower.includes("no such") || lower.includes("resource_missing")))
  ) {
    return isEn
      ? "That card is no longer valid. Add a card under Payment and try again."
      : "Kortet er ikke lenger gyldig. Legg til et kort under Betaling og prøv igjen.";
  }

  if (/card_declined|your card was declined/.test(lower)) {
    return isEn
      ? "The card was declined. Try another card."
      : "Kortet ble avvist. Prøv et annet kort.";
  }

  if (/expired_card|expired/.test(lower) && /card/.test(lower)) {
    return isEn
      ? "That card has expired. Add a new card under Payment."
      : "Kortet er utløpt. Legg til et nytt kort under Betaling.";
  }

  if (/insufficient_funds/.test(lower)) {
    return isEn
      ? "The card does not have enough funds."
      : "Kortet har ikke dekning.";
  }

  if (/authentication_required|requires.?action|3ds/.test(lower)) {
    return isEn
      ? "The bank needs extra confirmation. Try again and complete the check."
      : "Banken krever ekstra bekreftelse. Prøv igjen og fullfør sjekken.";
  }

  if (/price_lock_expired/.test(lower)) {
    return isEn
      ? "Price lock expired. Confirm again to search."
      : "Prislås utløpt. Bekreft igjen for å søke.";
  }

  if (!s || /payment_confirm_failed|payment failed/i.test(s)) {
    return isEn ? "Payment failed. Try again." : "Betaling mislyktes. Prøv igjen.";
  }

  if (/^pi_status_/i.test(s) || (/^stripe/i.test(s) && s.includes("_"))) {
    return isEn ? "Payment failed. Try again." : "Betaling mislyktes. Prøv igjen.";
  }

  return s;
}
