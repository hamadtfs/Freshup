/**
 * Client-side helpers for FreshUp Pricing spec §2.1 — provider base-price
 * submission during signup / onboarding.
 */

export type SignupPriceFailure = { serviceId: string; reason: string };

function readCoordinate(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export async function readDeviceLocation(): Promise<{
  lat: number;
  lng: number;
} | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: 12_000 },
    );
  });
}

export async function resolveSignupPriceCoords(
  providerId: string,
  cachedCoords: { lat: number; lng: number } | null,
): Promise<{ lat: number; lng: number } | null> {
  if (cachedCoords) return cachedCoords;
  try {
    const res = await fetch("/api/providers/me", {
      cache: "no-store",
      headers: { "x-provider-id": providerId },
    });
    if (res.ok) {
      const body = await res.json();
      const defaultLocation = body?.defaultLocation || {};
      const contact = body?.contact || {};
      const lat =
        readCoordinate(defaultLocation.lat) ?? readCoordinate(contact.lat);
      const lng =
        readCoordinate(defaultLocation.lng) ?? readCoordinate(contact.lng);
      if (lat != null && lng != null) return { lat, lng };
    }
  } catch {
    /* fall through to device GPS */
  }
  return readDeviceLocation();
}

export async function saveProviderSignupCoords(
  providerId: string,
  coords: { lat: number; lng: number },
): Promise<void> {
  await fetch("/api/providers/me", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "x-provider-id": providerId,
    },
    body: JSON.stringify({ lat: coords.lat, lng: coords.lng }),
  });
}

export async function submitSignupBasePrices(input: {
  providerId: string;
  servicePrices: Record<string, string>;
  serviceIds: string[];
  coords: { lat: number; lng: number } | null;
}): Promise<SignupPriceFailure[]> {
  const priceSubmissions = input.serviceIds
    .map((serviceId) => {
      const raw = input.servicePrices[serviceId];
      if (raw == null) return null;
      const parsed = Number(String(raw).trim());
      if (!Number.isFinite(parsed) || parsed <= 0) return null;
      return { serviceId, price: parsed };
    })
    .filter(
      (entry): entry is { serviceId: string; price: number } => entry !== null,
    );

  if (priceSubmissions.length === 0) return [];

  if (
    !input.coords ||
    !Number.isFinite(input.coords.lat) ||
    !Number.isFinite(input.coords.lng)
  ) {
    return priceSubmissions.map(({ serviceId }) => ({
      serviceId,
      reason: "missing_coordinates",
    }));
  }

  const failures: SignupPriceFailure[] = [];
  await Promise.all(
    priceSubmissions.map(async ({ serviceId, price }) => {
      try {
        const res = await fetch("/api/pricing/submit-base", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-provider-id": input.providerId,
          },
          body: JSON.stringify({
            service_id: serviceId,
            price,
            source: "signup",
            lat: input.coords!.lat,
            lng: input.coords!.lng,
          }),
        });
        if (!res.ok) {
          let body: { reason?: string; error?: string } | null = null;
          try {
            body = await res.json();
          } catch {
            /* ignore */
          }
          failures.push({
            serviceId,
            reason: String(
              body?.reason || body?.error || `HTTP ${res.status}`,
            ),
          });
        }
      } catch {
        failures.push({ serviceId, reason: "NETWORK_ERROR" });
      }
    }),
  );

  return failures;
}

export function formatSignupPriceFailureMessage(
  failures: SignupPriceFailure[],
  isEn: boolean,
): string {
  const reasons = new Set(failures.map((f) => f.reason));
  const isAreaIssue =
    reasons.has("AREA_UNKNOWN") ||
    reasons.has("missing_coordinates") ||
    reasons.has("area_resolution_failed");

  if (isAreaIssue) {
    return reasons.has("missing_coordinates")
      ? isEn
        ? "Account created, but prices were not saved. Allow location access and re-enter your prices from Skills."
        : "Konto opprettet, men prisene ble ikke lagret. Tillat posisjon og legg inn prisene igjen under Ferdigheter."
      : isEn
        ? "Account created, but prices were not saved. We could not determine your service area — set a map pin in Profile, then re-enter prices from Skills."
        : "Konto opprettet, men prisene ble ikke lagret. Vi fant ikke tjenesteområdet — sett et kartpunkt i Profil, og legg inn prisene igjen under Ferdigheter.";
  }

  return isEn
    ? `Account created, but ${failures.length} price${failures.length === 1 ? "" : "s"} could not be saved. Re-enter them from Skills.`
    : `Konto opprettet, men ${failures.length} pris${failures.length === 1 ? "" : "er"} kunne ikke lagres. Legg dem inn igjen under Ferdigheter.`;
}
