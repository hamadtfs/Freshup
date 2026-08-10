/** Ambient browse-map fleet (Uber-style cars before booking). */

export type FleetLatLng = { lat: number; lng: number };

export type SimulatedFleetUnit = {
  id: string;
  lat: number;
  lng: number;
  heading: number;
  /** Free-drift fallback when no road path is attached. */
  speedDegPerSec: number;
  turnBias: number;
  /** Road polyline to follow (Mapbox/OSRM). */
  path?: FleetLatLng[];
  /** Distance along `path` in meters. */
  pathMeters?: number;
  /** Speed along road path (m/s). */
  speedMps?: number;
  pathForward?: boolean;
};

const MIN_HOME_FLEET = 10;
const MAX_HOME_FLEET = 16;
/** ~1.4 km from center — keeps cars visible but not stacked. */
const MAX_RADIUS_DEG = 0.0125;
/** Minimum angular gap between seed slots (radians). */
const MIN_SLOT_GAP = (Math.PI * 2) / 18;

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function approxMeters(a: FleetLatLng, b: FleetLatLng): number {
  const dLat = (b.lat - a.lat) * 111_320;
  const cos = Math.cos((a.lat * Math.PI) / 180);
  const dLng = (b.lng - a.lng) * 111_320 * cos;
  return Math.hypot(dLat, dLng);
}

function bearingDeg(a: FleetLatLng, b: FleetLatLng): number {
  const dLng = b.lng - a.lng;
  const y = Math.sin((dLng * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180);
  const x =
    Math.cos((a.lat * Math.PI) / 180) * Math.sin((b.lat * Math.PI) / 180) -
    Math.sin((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.cos((dLng * Math.PI) / 180);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function pathLengthMeters(path: FleetLatLng[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += approxMeters(path[i - 1], path[i]);
  }
  return total;
}

function pointAlongPath(
  path: FleetLatLng[],
  meters: number,
): { lat: number; lng: number; heading: number } {
  if (path.length === 0) {
    return { lat: 0, lng: 0, heading: 0 };
  }
  if (path.length === 1) {
    return { lat: path[0].lat, lng: path[0].lng, heading: 0 };
  }

  const total = pathLengthMeters(path);
  const clamped = Math.max(0, Math.min(total, meters));
  let remaining = clamped;

  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const seg = approxMeters(a, b);
    if (seg <= 0.01) continue;
    if (remaining <= seg) {
      const t = remaining / seg;
      return {
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
        heading: bearingDeg(a, b),
      };
    }
    remaining -= seg;
  }

  const last = path[path.length - 1];
  const prev = path[path.length - 2];
  return {
    lat: last.lat,
    lng: last.lng,
    heading: bearingDeg(prev, last),
  };
}

export function desiredSimulatedFleetCount(realCount: number): number {
  if (realCount >= MIN_HOME_FLEET) return 0;
  return Math.min(MAX_HOME_FLEET, MIN_HOME_FLEET - realCount);
}

/** Evenly spaced ring points used as road-route endpoints. */
export function ambientFleetWaypoints(
  center: FleetLatLng,
  count: number,
  filterKey: string,
): FleetLatLng[] {
  if (count <= 0) return [];
  const rand = mulberry32(hashString(`wp-${filterKey}`));
  const points: FleetLatLng[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (rand() - 0.5) * MIN_SLOT_GAP;
    const radius = (0.55 + rand() * 0.45) * MAX_RADIUS_DEG;
    points.push({
      lat: center.lat + Math.cos(angle) * radius,
      lng: center.lng + Math.sin(angle) * radius * 1.35,
    });
  }
  return points;
}

export function seedSimulatedFleet(
  center: FleetLatLng,
  count: number,
  filterKey: string,
): SimulatedFleetUnit[] {
  if (count <= 0) return [];
  const rand = mulberry32(hashString(filterKey));
  const units: SimulatedFleetUnit[] = [];
  for (let i = 0; i < count; i++) {
    // Equal angular slots + light jitter → cars start spread out.
    const angle = (i / count) * Math.PI * 2 + (rand() - 0.5) * MIN_SLOT_GAP * 0.6;
    const radius = (0.5 + rand() * 0.5) * MAX_RADIUS_DEG;
    // Prefer road-ish headings (N/E/S/W with small noise).
    const cardinal = Math.floor(rand() * 4) * 90;
    units.push({
      id: `sim-${filterKey}-${i}`,
      lat: center.lat + Math.cos(angle) * radius,
      lng: center.lng + Math.sin(angle) * radius * 1.35,
      heading: (cardinal + (rand() - 0.5) * 24 + 360) % 360,
      speedDegPerSec: 0.00004 + rand() * 0.000035,
      turnBias: (rand() - 0.5) * 10,
      speedMps: 6.5 + rand() * 4.5,
      pathForward: true,
      pathMeters: 0,
    });
  }
  return units;
}

/**
 * Attach real driving polylines so cars follow roads.
 * `fetchRoute` should return Mapbox/OSRM coordinates (or null on failure).
 */
export async function hydrateSimulatedFleetPaths(
  units: SimulatedFleetUnit[],
  center: FleetLatLng,
  filterKey: string,
  fetchRoute: (
    from: FleetLatLng,
    to: FleetLatLng,
  ) => Promise<FleetLatLng[] | null>,
): Promise<SimulatedFleetUnit[]> {
  if (units.length === 0) return units;
  const waypoints = ambientFleetWaypoints(center, units.length, filterKey);
  if (waypoints.length < 2) return units;

  const hop = Math.max(1, Math.floor(units.length / 2));
  const out = units.slice();
  const concurrency = 3;

  for (let start = 0; start < units.length; start += concurrency) {
    const batch = units.slice(start, start + concurrency);
    const results = await Promise.all(
      batch.map(async (unit, batchIdx) => {
        const i = start + batchIdx;
        const from = waypoints[i];
        const to = waypoints[(i + hop) % waypoints.length];
        try {
          const path = await fetchRoute(from, to);
          if (!path || path.length < 2) return unit;
          const total = pathLengthMeters(path);
          if (total < 40) return unit;
          // Stagger cars along their routes so they don't bunch.
          const startMeters = ((i + 0.35) / units.length) * total * 0.85;
          const at = pointAlongPath(path, startMeters);
          return {
            ...unit,
            path,
            pathMeters: startMeters,
            pathForward: i % 2 === 0,
            lat: at.lat,
            lng: at.lng,
            heading: at.heading,
          };
        } catch {
          return unit;
        }
      }),
    );
    for (let j = 0; j < results.length; j++) {
      out[start + j] = results[j];
    }
  }

  return out;
}

function advanceAlongPath(
  unit: SimulatedFleetUnit,
  deltaMs: number,
): SimulatedFleetUnit {
  const path = unit.path;
  if (!path || path.length < 2) return unit;

  const total = pathLengthMeters(path);
  if (total < 20) return unit;

  const speed = unit.speedMps ?? 8;
  const dt = Math.max(0, deltaMs) / 1000;
  let meters = unit.pathMeters ?? 0;
  let forward = unit.pathForward !== false;
  const step = speed * dt;

  if (forward) {
    meters += step;
    if (meters >= total) {
      meters = total;
      forward = false;
    }
  } else {
    meters -= step;
    if (meters <= 0) {
      meters = 0;
      forward = true;
    }
  }

  const at = pointAlongPath(path, meters);
  let heading = at.heading;
  if (!forward) heading = (heading + 180) % 360;

  return {
    ...unit,
    lat: at.lat,
    lng: at.lng,
    heading,
    pathMeters: meters,
    pathForward: forward,
  };
}

function advanceFreeDrift(
  unit: SimulatedFleetUnit,
  center: FleetLatLng,
  deltaMs: number,
): SimulatedFleetUnit {
  const dt = Math.max(0, deltaMs) / 1000;
  // Prefer gentle turns toward cardinals so free-drift still looks street-like.
  const nearestCardinal = Math.round(unit.heading / 90) * 90;
  const towardCardinal = ((nearestCardinal - unit.heading + 540) % 360) - 180;
  let heading =
    unit.heading + unit.turnBias * dt * 0.35 + towardCardinal * 0.08 * dt;
  if (heading < 0) heading += 360;
  if (heading >= 360) heading -= 360;

  const rad = (heading * Math.PI) / 180;
  const step = unit.speedDegPerSec * dt;
  let lat = unit.lat + Math.cos(rad) * step;
  let lng = unit.lng + Math.sin(rad) * step * 1.35;

  const dLat = lat - center.lat;
  const dLng = (lng - center.lng) / 1.35;
  const dist = Math.hypot(dLat, dLng);
  if (dist > MAX_RADIUS_DEG) {
    const pull = (dist - MAX_RADIUS_DEG) / dist;
    lat -= dLat * pull * 0.55;
    lng -= dLng * pull * 0.55 * 1.35;
    heading = (heading + 180) % 360;
  }

  return {
    ...unit,
    lat,
    lng,
    heading,
    turnBias: unit.turnBias + (Math.random() - 0.5) * 1.2 * dt,
  };
}

export function advanceSimulatedFleet(
  units: SimulatedFleetUnit[],
  center: FleetLatLng,
  deltaMs: number,
): SimulatedFleetUnit[] {
  return units.map((unit) =>
    unit.path && unit.path.length >= 2
      ? advanceAlongPath(unit, deltaMs)
      : advanceFreeDrift(unit, center, deltaMs),
  );
}
