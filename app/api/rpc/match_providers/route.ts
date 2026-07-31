import { NextResponse } from "next/server"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/server"
import { matchProviders } from "@/lib/orders/dispatchOrder"
import { resolveCanonicalService } from "@/lib/service-id"

/**
 * Provider-side matching contract for the customer app team.
 * Hierarchy (mode / target / category / service) is taken from `services` by `service_id` so clients cannot widen matches.
 * Sort: distance ↑, then competence_rating ↓, within 10 km and provider radius.
 */

const bodySchema = z.object({
  mode_id: z.string().min(1),
  target_id: z.string().min(1),
  category_id: z.string().min(1),
  service_id: z.string().min(1),
  service_mode_id: z.enum(["home", "provider", "both"]),
  customer_lat: z.number().finite(),
  customer_lng: z.number().finite(),
  scheduled_at: z.string().min(1).nullable().optional(),
})

export async function POST(req: Request) {
  try {
    const raw = await req.json()
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json({ error: "INVALID_BODY", issues: parsed.error.flatten() }, { status: 400 })
    }

    const { mode_id, target_id, category_id, service_id, service_mode_id, customer_lat, customer_lng, scheduled_at } = parsed.data

    const supabase = createAdminClient()
    const service = await resolveCanonicalService<{
      id: string
      mode_id: string
      target_id: string
      category_id: string
      is_active: boolean | null
    }>(supabase, service_id, "id, mode_id, target_id, category_id, is_active")

    if (!service) {
      return NextResponse.json({ error: "SERVICE_NOT_FOUND" }, { status: 404 })
    }
    if (service.is_active === false) {
      return NextResponse.json({ error: "SERVICE_INACTIVE" }, { status: 400 })
    }
    if (service.mode_id !== mode_id || service.target_id !== target_id || service.category_id !== category_id) {
      return NextResponse.json({ error: "HIERARCHY_MISMATCH" }, { status: 400 })
    }

    const providers = await matchProviders(supabase, {
      mode_id,
      target_id,
      category_id,
      service_id: service.id,
      service_mode_id,
      customer_lat,
      customer_lng,
      scheduled_at: scheduled_at ?? null,
    })

    return NextResponse.json({ providers, count: providers.length })
  } catch (e) {
    console.error("[match_providers]", e)
    return NextResponse.json({ error: "MATCH_PROVIDERS_ERROR" }, { status: 500 })
  }
}
