import { getMapboxPublicAccessToken } from "@/lib/maps/mapbox-config";

export type ReverseGeocodeResult = {
  address: string;
  source: "mapbox" | "nominatim";
};

type MapboxFeature = {
  place_name?: string;
  text?: string;
  place_type?: string[];
  context?: Array<{ id?: string; text?: string }>;
};

function joinUnique(parts: Array<string | null | undefined>): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    const part = String(raw || "")
      .trim()
      .replace(/\s+/g, " ");
    if (!part) continue;
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(part);
  }
  return out.join(", ");
}

function ctxText(
  ctx: Array<{ id?: string; text?: string }> | undefined,
  prefix: string,
): string | null {
  return (
    ctx?.find((c) => String(c.id || "").startsWith(prefix))?.text?.trim() ||
    null
  );
}

function featureSpecificity(feature: MapboxFeature): number {
  const types = feature.place_type ?? [];
  if (types.includes("address")) return 50;
  if (types.includes("poi")) return 40;
  if (types.includes("neighborhood")) return 30;
  if (types.includes("locality")) return 20;
  if (types.includes("district")) return 15;
  if (types.includes("place")) return 10;
  return 0;
}

/** True when the label is only a city/region name (not useful as an address). */
function isCityOnlyLabel(label: string, cityHint?: string | null): boolean {
  const cleaned = label.trim().toLowerCase();
  if (!cleaned) return true;
  if (!cleaned.includes(",")) {
    if (cityHint && cleaned === cityHint.trim().toLowerCase()) return true;
    return cleaned.split(/\s+/).length <= 2;
  }
  return false;
}

function labelFromMapboxFeature(feature: MapboxFeature): string | null {
  const ctx = feature.context ?? [];
  const types = feature.place_type ?? [];
  const city =
    ctxText(ctx, "place") ||
    ctxText(ctx, "locality") ||
    ctxText(ctx, "district") ||
    null;
  const neighborhood = ctxText(ctx, "neighborhood");
  const text = String(feature.text || "").trim();

  if (
    types.includes("address") ||
    types.includes("poi") ||
    types.includes("neighborhood")
  ) {
    const area = text || neighborhood;
    const label = joinUnique([area, city]);
    if (label && !isCityOnlyLabel(label, city)) return label;
  }

  if (types.includes("locality") && text && city && text !== city) {
    const label = joinUnique([text, city]);
    if (label && !isCityOnlyLabel(label, city)) return label;
  }

  const placeName = String(feature.place_name || "").trim();
  if (placeName) {
    const parts = placeName
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      const label = joinUnique([parts[0], parts[1]]);
      if (label && !isCityOnlyLabel(label, city || parts[1])) return label;
    }
  }

  return null;
}

async function reverseViaMapbox(
  latitude: number,
  longitude: number,
): Promise<string | null> {
  const token = getMapboxPublicAccessToken();
  if (!token) return null;
  try {
    const url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/` +
      `${longitude},${latitude}.json` +
      `?access_token=${encodeURIComponent(token)}` +
      `&limit=5` +
      `&types=address,poi,neighborhood,locality,place`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { features?: MapboxFeature[] };
    const features = [...(data.features ?? [])].sort(
      (a, b) => featureSpecificity(b) - featureSpecificity(a),
    );

    for (const feature of features) {
      const label = labelFromMapboxFeature(feature);
      if (label) return label;
    }
    return null;
  } catch {
    return null;
  }
}

async function reverseViaNominatim(
  latitude: number,
  longitude: number,
): Promise<string | null> {
  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(latitude));
    url.searchParams.set("lon", String(longitude));
    url.searchParams.set("zoom", "18");
    url.searchParams.set("addressdetails", "1");
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      display_name?: string;
      name?: string;
      address?: {
        road?: string;
        pedestrian?: string;
        path?: string;
        neighbourhood?: string;
        suburb?: string;
        quarter?: string;
        city_district?: string;
        county?: string;
        city?: string;
        town?: string;
        village?: string;
        state_district?: string;
        state?: string;
      };
    };
    const a = data.address ?? {};
    const city =
      a.city || a.town || a.village || a.county || a.state_district || null;
    const area =
      a.road ||
      a.pedestrian ||
      a.path ||
      a.neighbourhood ||
      a.suburb ||
      a.quarter ||
      a.city_district ||
      (data.name && data.name !== city ? data.name : null) ||
      null;

    const fromParts = joinUnique([area, city]);
    if (fromParts && !isCityOnlyLabel(fromParts, city)) return fromParts;

    const display = String(data.display_name || "").trim();
    if (display) {
      const parts = display
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length >= 2) {
        const label = joinUnique([parts[0], parts[1]]);
        if (label && !isCityOnlyLabel(label, city || parts[1])) return label;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve lat/lng → short area label (e.g. "College Road, Lahore").
 * Rejects city-only answers and tries the next provider.
 */
export async function reverseGeocodeArea(
  latitude: number,
  longitude: number,
): Promise<ReverseGeocodeResult | null> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  // Nominatim first — better street coverage in many cities (e.g. Lahore).
  const nominatim = await reverseViaNominatim(latitude, longitude);
  if (nominatim) return { address: nominatim, source: "nominatim" };

  const mapbox = await reverseViaMapbox(latitude, longitude);
  if (mapbox) return { address: mapbox, source: "mapbox" };

  return null;
}
