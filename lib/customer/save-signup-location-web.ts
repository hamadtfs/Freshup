import { readDeviceLocation } from "@/lib/pricing/submit-signup-base-prices";

/**
 * Best-effort capture GPS after customer signup on web.
 * We persist it into `profiles.default_location_label/lat/lng` via
 * `PUT /api/customers/me` so `/api/customers/me` + Profile shows a pin.
 *
 * We do NOT block login; also avoid overwriting an existing saved pin.
 */
export async function captureAndSaveCustomerSignupLocationWeb(
  userId: string,
): Promise<void> {
  try {
    // Skip if the user already has a saved default pin.
    const existingRes = await fetch("/api/customers/me", {
      method: "GET",
      cache: "no-store",
      headers: {
        "x-user-id": userId,
      },
    });

    if (existingRes.ok) {
      const existingBody = await existingRes.json().catch(() => ({}));
      const lat =
        existingBody?.defaultLocation?.lat ?? existingBody?.defaultLocation?.lat;
      const lng =
        existingBody?.defaultLocation?.lng ?? existingBody?.defaultLocation?.lng;

      if (typeof lat === "number" && Number.isFinite(lat) && typeof lng === "number" && Number.isFinite(lng)) {
        return;
      }
    }

    const coords = await readDeviceLocation();
    if (!coords) return;

    if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return;

    await fetch("/api/customers/me", {
      method: "PUT",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": userId,
      },
      body: JSON.stringify({
        defaultLat: coords.lat,
        defaultLng: coords.lng,
      }),
    });
  } catch {
    // Permission denied / API failure should never block sign-in.
  }
}

