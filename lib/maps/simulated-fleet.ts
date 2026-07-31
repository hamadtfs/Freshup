/** Ambient browse-map fleet (Uber-style cars before booking). */

export type SimulatedFleetUnit = {
  id: string;
  lat: number;
  lng: number;
  heading: number;
  speedDegPerSec: number;
  turnBias: number;
};

const MIN_HOME_FLEET = 10;
const MAX_HOME_FLEET = 16;
/** ~500 m from center so browse fleet stays inside one 1×1 km demand grid cell. */
const MAX_RADIUS_DEG = 0.0045;

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

export function desiredSimulatedFleetCount(realCount: number): number {
  if (realCount >= MIN_HOME_FLEET) return 0;
  return Math.min(MAX_HOME_FLEET, MIN_HOME_FLEET - realCount);
}

export function seedSimulatedFleet(
  center: { lat: number; lng: number },
  count: number,
  filterKey: string,
): SimulatedFleetUnit[] {
  if (count <= 0) return [];
  const rand = mulberry32(hashString(filterKey));
  const units: SimulatedFleetUnit[] = [];
  for (let i = 0; i < count; i++) {
    const angle = rand() * Math.PI * 2;
    const radius = (0.35 + rand() * 0.65) * MAX_RADIUS_DEG;
    units.push({
      id: `sim-${filterKey}-${i}`,
      lat: center.lat + Math.cos(angle) * radius,
      lng: center.lng + Math.sin(angle) * radius * 1.35,
      heading: rand() * 360,
      speedDegPerSec: 0.000045 + rand() * 0.00004,
      turnBias: (rand() - 0.5) * 18,
    });
  }
  return units;
}

export function advanceSimulatedFleet(
  units: SimulatedFleetUnit[],
  center: { lat: number; lng: number },
  deltaMs: number,
): SimulatedFleetUnit[] {
  const dt = Math.max(0, deltaMs) / 1000;
  return units.map((unit) => {
    let heading = unit.heading + unit.turnBias * dt;
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
      lat -= dLat * pull * 0.65;
      lng -= dLng * pull * 0.65 * 1.35;
      heading = (heading + 180) % 360;
    }

    return {
      ...unit,
      lat,
      lng,
      heading,
      turnBias: unit.turnBias + (Math.random() - 0.5) * 2 * dt,
    };
  });
}
