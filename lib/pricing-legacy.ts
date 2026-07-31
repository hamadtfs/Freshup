import type { LatLng } from "./geo"
import { haversineKm, kmToEtaMinutes } from "./geo"

export type DemandLevel = "low" | "medium" | "high"

export function demandMultiplier(demand: DemandLevel) {
  if (demand === "low") return 1.0
  if (demand === "medium") return 1.2
  return 1.5
}

export function computePriceEstimate({
  mode,
  style,
  demand,
  customer,
  salon,
  addonsTotal = 0,
}: {
  mode: "home" | "salon"
  style: {
    id: string
    base_price_min: number
    base_price_max: number
    base_minutes: number
  }
  demand: DemandLevel
  customer: LatLng
  salon: LatLng | null
  addonsTotal?: number
}) {
  const perKm = 8 // NOK/km
  const surgeUnit = 20 // NOK per unit multiplier
  const homeFee = 60 // NOK

  // Distance basis:
  // - home: assume average provider distance ~ 2.0km for estimate when no live provider picked
  // - salon: distance customer->salon if provided
  const distanceKm = mode === "home" ? 2.0 : salon ? haversineKm(customer, salon) : 2.0

  const basePrice = (style.base_price_min + style.base_price_max) / 2 + addonsTotal

  const mult = demandMultiplier(demand)
  const price_est = basePrice + distanceKm * perKm + mult * surgeUnit + (mode === "home" ? homeFee : 0)

  const price_min = Math.max(100, Math.round(price_est * 0.9))
  const price_max = Math.round(price_est * 1.1)

  // ETA: if salon, use distance to salon; else use assumed provider distance
  const eta_minutes = mode === "salon" ? kmToEtaMinutes(distanceKm, 28) : kmToEtaMinutes(distanceKm, 28)

  return { price_min, price_max, eta_minutes }
}
