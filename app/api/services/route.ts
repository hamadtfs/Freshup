// =====================================================
// Fresh Up - Get Services API Route
// =====================================================
// GET /api/services?mode=beauty&target=male&category=haircut
// Fetch services for a specific category

import { createAdminClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"

export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient()

    const searchParams = req.nextUrl.searchParams
    const mode = searchParams.get("mode")
    const target = searchParams.get("target")
    const category = searchParams.get("category")

    // If category is provided, fetch services for that category
    if (category) {
      const { data: services, error } = await supabase
        .from("services")
        .select("*")
        .eq("category_id", category)
        .eq("active", true)
        .order("sort_order", { ascending: true })

      if (error) {
        console.error("[v0] Fetch services error:", error)
        return NextResponse.json(
          { error: "Failed to fetch services" },
          { status: 500 }
        )
      }

      return NextResponse.json({ services })
    }

    // If target is provided, fetch categories for that target
    if (target) {
      const { data: categories, error } = await supabase
        .from("categories")
        .select("*")
        .eq("target_id", target)
        .order("sort_order", { ascending: true })

      if (error) {
        console.error("[v0] Fetch categories error:", error)
        return NextResponse.json(
          { error: "Failed to fetch categories" },
          { status: 500 }
        )
      }

      return NextResponse.json({ categories })
    }

    // If mode is provided, fetch targets for that mode
    if (mode) {
      const { data: targets, error } = await supabase
        .from("targets")
        .select("*")
        .eq("mode_id", mode)
        .order("sort_order", { ascending: true })

      if (error) {
        console.error("[v0] Fetch targets error:", error)
        return NextResponse.json(
          { error: "Failed to fetch targets" },
          { status: 500 }
        )
      }

      return NextResponse.json({ targets })
    }

    // If no filters, fetch all modes
    const { data: modes, error } = await supabase
      .from("modes")
      .select("*")
      .order("sort_order", { ascending: true })

    if (error) {
      console.error("[v0] Fetch modes error:", error)
      return NextResponse.json(
        { error: "Failed to fetch modes" },
        { status: 500 }
      )
    }

    return NextResponse.json({ modes })
  } catch (error) {
    console.error("[v0] API error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
