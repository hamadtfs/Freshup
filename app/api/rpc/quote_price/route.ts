import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { haversineKm, kmToEtaMinutes } from "@/lib/geo"

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const {
      mode,
      style_id,
      customer_lat,
      customer_lng,
      salon_lat,
      salon_lng,
      addons = [],
    } = body as {
      mode: "home" | "salon"
      style_id: string
      customer_lat: number
      customer_lng: number
      salon_lat?: number
      salon_lng?: number
      addons?: string[]
    }

    const supabase = createAdminClient()
    const { data: style } = await supabase.from("styles").select("*").eq("id", style_id).single()

    if (!style) {
      return NextResponse.json({ error: "STYLE_NOT_FOUND" }, { status: 400 })
    }

    // Addons total (optional lookup later; for now ignore or assume 0)
    const addonsTotal = 0

    // distance basis
    let distanceKm = 2.0
    if (mode === "salon" && salon_lat != null && salon_lng != null) {
      distanceKm = haversineKm({ lat: customer_lat, lng: customer_lng }, { lat: salon_lat, lng: salon_lng })
    }

    const demandMap: Record<string, number> = { low: 1.0, medium: 1.2, high: 1.5 }
    const mult = demandMap[style.demand ?? "low"] ?? 1.0
    const perKm = 8
    const surgeUnit = 20
    const homeFee = 60
    const basePrice = (style.base_price_min + style.base_price_max) / 2 + addonsTotal

    const price_est = basePrice + distanceKm * perKm + mult * surgeUnit + (mode === "home" ? homeFee : 0)

    const price_min = Math.max(100, Math.round(price_est * 0.9))
    const price_max = Math.round(price_est * 1.1)
    const eta_minutes = kmToEtaMinutes(distanceKm, 28)

    return NextResponse.json({ price_min, price_max, eta_minutes })
  } catch (e) {
    return NextResponse.json({ error: "QUOTE_ERROR" }, { status: 500 })
  }
}
