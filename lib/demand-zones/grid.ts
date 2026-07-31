/**
 * ~1 km demand-zone grid (separate from pricing_areas ~22 km cells).
 */

const KM_PER_DEG_LAT = 111;
export const DEMAND_ZONE_GRID_KM = 1;

export function gridStepLat(): number {
  return DEMAND_ZONE_GRID_KM / KM_PER_DEG_LAT;
}

export function gridStepLng(lat: number): number {
  const cos = Math.cos((lat * Math.PI) / 180);
  return DEMAND_ZONE_GRID_KM / (KM_PER_DEG_LAT * Math.max(cos, 0.2));
}

export function latLngToGridId(lat: number, lng: number): string {
  const stepLat = gridStepLat();
  const latIdx = Math.floor(lat / stepLat);
  const stepLng = gridStepLng(lat);
  const lngIdx = Math.floor(lng / stepLng);
  return `g_${latIdx}_${lngIdx}`;
}

export function gridIdToCenter(gridId: string): { lat: number; lng: number } | null {
  const m = /^g_(-?\d+)_(-?\d+)$/.exec(gridId);
  if (!m) return null;
  const latIdx = Number(m[1]);
  const lngIdx = Number(m[2]);
  if (!Number.isFinite(latIdx) || !Number.isFinite(lngIdx)) return null;
  const stepLat = gridStepLat();
  const lat = (latIdx + 0.5) * stepLat;
  const stepLng = gridStepLng(lat);
  const lng = (lngIdx + 0.5) * stepLng;
  return { lat, lng };
}

export function gridIdToBounds(gridId: string): {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
} | null {
  const m = /^g_(-?\d+)_(-?\d+)$/.exec(gridId);
  if (!m) return null;
  const latIdx = Number(m[1]);
  const lngIdx = Number(m[2]);
  const stepLat = gridStepLat();
  const minLat = latIdx * stepLat;
  const maxLat = minLat + stepLat;
  const stepLng = gridStepLng((minLat + maxLat) / 2);
  const minLng = lngIdx * stepLng;
  const maxLng = minLng + stepLng;
  return { minLat, maxLat, minLng, maxLng };
}

/** Grid cell ids intersecting a bounding box (for map viewport APIs). */
export function countGridCellsInBbox(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
): number {
  const stepLat = gridStepLat();
  const latStart = Math.floor(minLat / stepLat);
  const latEnd = Math.floor(maxLat / stepLat);
  let count = 0;
  for (let latIdx = latStart; latIdx <= latEnd; latIdx++) {
    const lat = (latIdx + 0.5) * stepLat;
    const stepLng = gridStepLng(lat);
    const lngStart = Math.floor(minLng / stepLng);
    const lngEnd = Math.floor(maxLng / stepLng);
    count += lngEnd - lngStart + 1;
  }
  return count;
}

function collectAllGridIdsInBbox(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
  maxCells: number,
): string[] {
  const stepLat = gridStepLat();
  const latStart = Math.floor(minLat / stepLat);
  const latEnd = Math.floor(maxLat / stepLat);
  const ids: string[] = [];
  for (let latIdx = latStart; latIdx <= latEnd; latIdx++) {
    const lat = (latIdx + 0.5) * stepLat;
    const stepLng = gridStepLng(lat);
    const lngStart = Math.floor(minLng / stepLng);
    const lngEnd = Math.floor(maxLng / stepLng);
    for (let lngIdx = lngStart; lngIdx <= lngEnd; lngIdx++) {
      ids.push(`g_${latIdx}_${lngIdx}`);
      if (ids.length >= maxCells) return ids;
    }
  }
  return ids;
}

/** Expand outward from center so zoomed-out maps still cover the viewport middle. */
export function gridIdsAroundCenterInBbox(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
  centerLat: number,
  centerLng: number,
  maxCells = 200,
): string[] {
  const centerGridId = latLngToGridId(centerLat, centerLng);
  const m = /^g_(-?\d+)_(-?\d+)$/.exec(centerGridId);
  if (!m) return [];

  const centerLatIdx = Number(m[1]);
  const centerLngIdx = Number(m[2]);
  if (!Number.isFinite(centerLatIdx) || !Number.isFinite(centerLngIdx)) {
    return [];
  }

  const ids: string[] = [];
  const seen = new Set<string>();

  const tryAdd = (latIdx: number, lngIdx: number) => {
    const id = `g_${latIdx}_${lngIdx}`;
    if (seen.has(id)) return;
    const cellCenter = gridIdToCenter(id);
    if (!cellCenter) return;
    if (
      cellCenter.lat < minLat ||
      cellCenter.lat > maxLat ||
      cellCenter.lng < minLng ||
      cellCenter.lng > maxLng
    ) {
      return;
    }
    seen.add(id);
    ids.push(id);
  };

  for (let ring = 0; ring < 80 && ids.length < maxCells; ring++) {
    for (let dLat = -ring; dLat <= ring; dLat++) {
      for (let dLng = -ring; dLng <= ring; dLng++) {
        if (ring > 0 && Math.abs(dLat) !== ring && Math.abs(dLng) !== ring) {
          continue;
        }
        tryAdd(centerLatIdx + dLat, centerLngIdx + dLng);
        if (ids.length >= maxCells) return ids;
      }
    }
  }

  return ids;
}

export function gridIdsInBbox(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
  maxCells = 200,
  opts?: { centerLat?: number; centerLng?: number },
): string[] {
  const total = countGridCellsInBbox(minLat, minLng, maxLat, maxLng);
  if (total <= maxCells) {
    return collectAllGridIdsInBbox(minLat, minLng, maxLat, maxLng, maxCells);
  }

  const centerLat = opts?.centerLat ?? (minLat + maxLat) / 2;
  const centerLng = opts?.centerLng ?? (minLng + maxLng) / 2;
  return gridIdsAroundCenterInBbox(
    minLat,
    minLng,
    maxLat,
    maxLng,
    centerLat,
    centerLng,
    maxCells,
  );
}

export function demandGridCellBoundsAt(
  lat: number,
  lng: number,
): {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
} | null {
  return gridIdToBounds(latLngToGridId(lat, lng));
}

/** ~spanKm box centered on a point (keeps the user pin in the middle of the viewport). */
export function viewportBoundsCenteredOn(
  lat: number,
  lng: number,
  spanKm: number = DEMAND_ZONE_GRID_KM,
): {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
} {
  const halfLat = spanKm / 2 / KM_PER_DEG_LAT;
  const cos = Math.cos((lat * Math.PI) / 180);
  const halfLng = spanKm / 2 / (KM_PER_DEG_LAT * Math.max(cos, 0.2));
  return {
    minLat: lat - halfLat,
    maxLat: lat + halfLat,
    minLng: lng - halfLng,
    maxLng: lng + halfLng,
  };
}

/** Mercator zoom so spanKm fits in the given viewport (approx). */
export function zoomLevelForKmSpan(
  lat: number,
  spanKm: number,
  viewportWidthPx: number,
  viewportHeightPx: number,
): number {
  const latRad = (lat * Math.PI) / 180;
  const spanM = spanKm * 1000;
  const minSide = Math.max(1, Math.min(viewportWidthPx, viewportHeightPx));
  const metersPerPixel = spanM / minSide;
  const zoom = Math.log2((156543.033 * Math.cos(latRad)) / metersPerPixel);
  return Math.min(16, Math.max(11, zoom));
}

export function pointInBounds(
  lat: number,
  lng: number,
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number },
): boolean {
  return (
    lat >= bounds.minLat &&
    lat <= bounds.maxLat &&
    lng >= bounds.minLng &&
    lng <= bounds.maxLng
  );
}
