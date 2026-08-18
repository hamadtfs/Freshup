import { createAdminClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"

interface CustomerProfileUpdatePayload {
  name?: string
  phone?: string
  email?: string
  avatarUrl?: string
  address?: string
  lat?: number
  lng?: number
  defaultLat?: number
  defaultLng?: number
  defaultAddress?: string
  notificationOptIn?: boolean
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function normalizeAvatar(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.startsWith("data:image/")) return trimmed
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return null
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null
  return value
}

function readProfileLocation(profile: Record<string, unknown> | null | undefined) {
  const address = normalizeString(profile?.default_location_label) || ""
  const lat = normalizeNumber(profile?.lat)
  const lng = normalizeNumber(profile?.lng)
  return { address, lat, lng }
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const userId = req.headers.get("x-user-id")
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const [{ data: profile, error }, authUser] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.auth.admin.getUserById(userId),
    ])
    if (error) throw error

    const location = readProfileLocation(profile as Record<string, unknown> | null)
    const notificationOptIn =
      (profile as { notification_opt_in?: boolean } | null)?.notification_opt_in !==
      false

    const profileEmail = normalizeString((profile as any)?.email)
    const authEmail =
      normalizeString(authUser.data?.user?.email) ||
      normalizeString(authUser.data?.user?.user_metadata?.email)
    const email = profileEmail || authEmail || ""
    if (profile && email && !profileEmail) {
      void supabase
        .from("profiles")
        .update({ email, updated_at: new Date().toISOString() })
        .eq("id", userId)
    }

    return NextResponse.json({
      profile: profile || null,
      contact: {
        name: normalizeString((profile as any)?.display_name) || "",
        phone: normalizeString((profile as any)?.phone) || "",
        email,
        avatarUrl: normalizeAvatar((profile as any)?.avatar_url) || "",
        address: location.address,
        lat: location.lat,
        lng: location.lng,
      },
      defaultLocation: location,
      notificationOptIn,
    })
  } catch (error) {
    console.error("[v0] Get customer error:", error)
    return NextResponse.json({ error: "Failed to fetch customer" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const userId = req.headers.get("x-user-id")
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const updates = (await req.json()) as CustomerProfileUpdatePayload
    const raw = updates as Record<string, unknown>

    // Lean path: notification toggle only.
    const payloadKeys = Object.keys(raw).filter((k) => raw[k] !== undefined)
    if (
      payloadKeys.length === 1 &&
      payloadKeys[0] === "notificationOptIn"
    ) {
      const notificationOptIn = Boolean(raw.notificationOptIn)
      const now = new Date().toISOString()
      const { data: existingProfile, error: profileReadErr } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", userId)
        .maybeSingle()
      if (profileReadErr) throw profileReadErr
      if (existingProfile?.id) {
        const { error: optInErr } = await supabase
          .from("profiles")
          .update({
            notification_opt_in: notificationOptIn,
            updated_at: now,
          })
          .eq("id", userId)
        if (optInErr) throw optInErr
      } else {
        const { error: optInErr } = await supabase.from("profiles").insert({
          id: userId,
          notification_opt_in: notificationOptIn,
          updated_at: now,
        })
        if (optInErr) throw optInErr
      }
      return NextResponse.json({
        success: true,
        notificationOptIn,
      })
    }

    const { data: existing, error: existingErr } = await supabase
      .from("profiles")
      .select(
        "display_name, phone, email, avatar_url, default_location_label, lat, lng, notification_opt_in",
      )
      .eq("id", userId)
      .maybeSingle()
    if (existingErr) throw existingErr

    const pickNullableString = (
      payloadKey: keyof CustomerProfileUpdatePayload,
      column: "display_name" | "phone" | "email" | "default_location_label",
    ): string | null => {
      if (!Object.prototype.hasOwnProperty.call(raw, payloadKey)) {
        return normalizeString((existing as any)?.[column])
      }
      return normalizeString((updates as any)?.[payloadKey])
    }

    const pickCoord = (
      primaryKey: "lat" | "lng",
      aliasKey: "defaultLat" | "defaultLng",
    ): number | null => {
      if (Object.prototype.hasOwnProperty.call(raw, primaryKey)) {
        const incoming = (updates as any)[primaryKey]
        if (incoming === null || incoming === undefined) {
          return normalizeNumber((existing as any)?.[primaryKey])
        }
        return normalizeNumber(incoming)
      }
      if (Object.prototype.hasOwnProperty.call(raw, aliasKey)) {
        const incoming = (updates as any)[aliasKey]
        if (incoming === null || incoming === undefined) {
          return normalizeNumber((existing as any)?.[primaryKey])
        }
        return normalizeNumber(incoming)
      }
      return normalizeNumber((existing as any)?.[primaryKey])
    }

    const pickAddressWithAlias = (): string | null => {
      if (Object.prototype.hasOwnProperty.call(raw, "address")) {
        return pickNullableString("address", "default_location_label")
      }
      if (Object.prototype.hasOwnProperty.call(raw, "defaultAddress")) {
        return normalizeString(updates.defaultAddress)
      }
      return normalizeString((existing as any)?.default_location_label)
    }

    const name = pickNullableString("name", "display_name")
    const phone = pickNullableString("phone", "phone")
    const email = pickNullableString("email", "email")
    const avatarUrl = Object.prototype.hasOwnProperty.call(raw, "avatarUrl")
      ? normalizeAvatar(updates.avatarUrl)
      : normalizeAvatar((existing as any)?.avatar_url)
    const address = pickAddressWithAlias()
    const lat = pickCoord("lat", "defaultLat")
    const lng = pickCoord("lng", "defaultLng")

    if (email && !isValidEmail(email)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 })
    }

    const notificationOptIn = Object.prototype.hasOwnProperty.call(
      raw,
      "notificationOptIn",
    )
      ? Boolean(updates.notificationOptIn)
      : (existing as { notification_opt_in?: boolean } | null)
          ?.notification_opt_in !== false

    const now = new Date().toISOString()
    const baseProfile = {
      id: userId,
      display_name: name,
      email,
      phone,
      avatar_url: avatarUrl,
      default_location_label: address || null,
      lat,
      lng,
      notification_opt_in: notificationOptIn,
      updated_at: now,
    }
    const { error: profileErr } = await supabase
      .from("profiles")
      .upsert(baseProfile, { onConflict: "id" })
    if (profileErr) throw profileErr

    const location = {
      address: address || "",
      lat,
      lng,
    }

    return NextResponse.json({
      success: true,
      contact: {
        name: name || "",
        phone: phone || "",
        email: email || "",
        avatarUrl: avatarUrl || "",
        ...location,
      },
      defaultLocation: location,
      notificationOptIn,
    })
  } catch (error) {
    console.error("[v0] Update customer error:", error)
    return NextResponse.json({ error: "Failed to update customer" }, { status: 500 })
  }
}
