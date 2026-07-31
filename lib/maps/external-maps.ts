/** Open turn-by-turn navigation in the device maps app (no in-app SDK). */

export type LatLng = { lat: number; lng: number };

export function buildGoogleMapsDirectionsUrl(
  destination: LatLng,
  origin?: LatLng | null,
): string {
  const dest = `${destination.lat},${destination.lng}`;
  const params = new URLSearchParams({ api: "1", destination: dest });
  if (origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng)) {
    params.set("origin", `${origin.lat},${origin.lng}`);
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function buildAppleMapsDirectionsUrl(
  destination: LatLng,
  origin?: LatLng | null,
): string {
  const params = new URLSearchParams({
    daddr: `${destination.lat},${destination.lng}`,
    dirflg: "d",
  });
  if (origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng)) {
    params.set("saddr", `${origin.lat},${origin.lng}`);
  }
  return `https://maps.apple.com/?${params.toString()}`;
}

function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iPhone|iPad|iPod|Macintosh/i.test(ua);
}

/** Prefer Apple Maps on iOS/macOS; Google Maps elsewhere. */
export function openExternalMapsDirections(
  destination: LatLng,
  origin?: LatLng | null,
): void {
  if (typeof window === "undefined") return;
  const url = isApplePlatform()
    ? buildAppleMapsDirectionsUrl(destination, origin)
    : buildGoogleMapsDirectionsUrl(destination, origin);
  window.open(url, "_blank", "noopener,noreferrer");
}
