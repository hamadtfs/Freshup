export type LatLng = { lat: number; lng: number }

export function haversineKm(a: LatLng, b: LatLng) {
  const R = 6371
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2)
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
  return R * c
}

function toRad(deg: number) {
  return (deg * Math.PI) / 180
}

// Straight-line interpolation to simulate a route
export function interpolateRoute(a: LatLng, b: LatLng, points = 100): LatLng[] {
  const out: LatLng[] = []
  for (let i = 0; i <= points; i++) {
    const t = i / points
    out.push({
      lat: a.lat + (b.lat - a.lat) * t,
      lng: a.lng + (b.lng - a.lng) * t,
    })
  }
  return out
}

/** Snap polyline endpoints with marker pins so lines don't overshoot dots. */
export function snapRouteEndpoints(
  coords: LatLng[],
  from: LatLng,
  to: LatLng,
): LatLng[] {
  if (coords.length < 2) return coords
  const out = coords.slice()
  out[0] = from
  out[out.length - 1] = to
  return out
}

/** Drop route vertices hugging endpoints so thick line caps don't bleed past markers. */
export function clipRouteForMarkerDisplay(
  coords: LatLng[],
  from: LatLng,
  to: LatLng,
  clipM = 32,
): LatLng[] {
  if (coords.length < 2) return coords
  const clipKm = clipM / 1000
  let start = 0
  for (let i = 1; i < coords.length; i++) {
    if (haversineKm(from, coords[i]) >= clipKm) {
      start = i - 1
      break
    }
    if (i === coords.length - 1) start = coords.length - 1
  }
  let end = coords.length - 1
  for (let i = coords.length - 2; i >= 0; i--) {
    if (haversineKm(to, coords[i]) >= clipKm) {
      end = i + 1
      break
    }
    if (i === 0) end = 0
  }
  let sliced = coords.slice(start, end + 1)
  if (sliced.length < 2) return snapRouteEndpoints(coords, from, to)
  sliced = snapRouteEndpoints(sliced, from, to)

  // Drop road-geometry hooks that jog past snapped endpoints.
  while (sliced.length >= 3) {
    const towardTo1 = haversineKm(to, sliced[1])
    const towardTo2 = haversineKm(to, sliced[2])
    if (towardTo1 > towardTo2 + 0.0005) {
      sliced.splice(1, 1)
      sliced[0] = from
      continue
    }
    break
  }
  while (sliced.length >= 3) {
    const n = sliced.length
    const towardFrom1 = haversineKm(from, sliced[n - 2])
    const towardFrom2 = haversineKm(from, sliced[n - 3])
    if (towardFrom1 > towardFrom2 + 0.0005) {
      sliced.splice(n - 2, 1)
      sliced[sliced.length - 1] = to
      continue
    }
    break
  }

  return sliced.length >= 2 ? sliced : snapRouteEndpoints(coords, from, to)
}

/** Keep only the polyline segment between two visible map pins. */
export function sliceRouteForDisplay(
  coords: LatLng[],
  from: LatLng,
  to: LatLng,
): LatLng[] {
  if (coords.length < 2) return snapRouteEndpoints(coords, from, to)

  let fromIdx = 0
  let bestFrom = Infinity
  let toIdx = coords.length - 1
  let bestTo = Infinity

  for (let i = 0; i < coords.length; i++) {
    const df = haversineKm(from, coords[i])
    if (df < bestFrom) {
      bestFrom = df
      fromIdx = i
    }
    const dt = haversineKm(to, coords[i])
    if (dt < bestTo) {
      bestTo = dt
      toIdx = i
    }
  }

  if (fromIdx === toIdx) {
    return snapRouteEndpoints([from, to], from, to)
  }

  const forward = fromIdx <= toIdx
  let slice = coords.slice(
    forward ? fromIdx : toIdx,
    forward ? toIdx + 1 : fromIdx + 1,
  )
  if (!forward) slice = [...slice].reverse()

  return alignRouteSegmentToPins(slice, from, to)
}

/** Snap route segment between two pins — follows road geometry, provider → customer. */
export function snapRouteToMarkers(
  coords: LatLng[],
  markerA: LatLng,
  markerB: LatLng,
): LatLng[] {
  return sliceRouteForDisplay(coords, markerA, markerB)
}

/**
 * Snap endpoints to markers and trim only small road hooks that overshoot a pin.
 */
export function alignRouteToMarkers(
  coords: LatLng[],
  markerA: LatLng,
  markerB: LatLng,
): LatLng[] {
  if (coords.length < 2) return snapRouteToMarkers(coords, markerA, markerB)

  const start = coords[0]
  const end = coords[coords.length - 1]
  const forwardScore =
    haversineKm(markerA, start) + haversineKm(markerB, end)
  const reverseScore =
    haversineKm(markerA, end) + haversineKm(markerB, start)
  const from = forwardScore <= reverseScore ? markerA : markerB
  const to = forwardScore <= reverseScore ? markerB : markerA
  const segment = forwardScore <= reverseScore ? coords : [...coords].reverse()

  return alignRouteSegmentToPins(segment, from, to)
}

function alignRouteSegmentToPins(
  coords: LatLng[],
  from: LatLng,
  to: LatLng,
): LatLng[] {
  let out = snapRouteEndpoints(coords.slice(), from, to)

  while (out.length >= 3) {
    const towardTo1 = haversineKm(to, out[out.length - 2])
    const towardTo2 = haversineKm(to, out[out.length - 3])
    if (towardTo1 > towardTo2 + 0.0005) {
      out.splice(out.length - 2, 1)
      out[out.length - 1] = to
      continue
    }
    break
  }

  while (out.length >= 3) {
    const towardFrom1 = haversineKm(from, out[1])
    const towardFrom2 = haversineKm(from, out[2])
    if (towardFrom1 > towardFrom2 + 0.0005) {
      out.splice(1, 1)
      out[0] = from
      continue
    }
    break
  }

  return out
}

export function kmToEtaMinutes(km: number, avgKmh = 28) {
  if (km <= 0) return 0
  const hours = km / Math.max(10, avgKmh)
  const mins = Math.round(hours * 60)
  return Math.max(1, mins)
}
