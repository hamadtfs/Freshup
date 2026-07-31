import { createAdminClient } from "@/lib/supabase/server"
import { getUserIdFromBearer } from "@/lib/supabase/route-user"
import { isProviderReportCategory } from "@/lib/reports/categories"
import { NextRequest, NextResponse } from "next/server"

export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const userId = await getUserIdFromBearer(supabase, req)
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = (await req.json()) as {
      order_id?: string
      provider_id?: string
      category?: string
      description?: string
    }

    const orderId = typeof body.order_id === "string" ? body.order_id.trim() : ""
    const category = body.category
    const description =
      typeof body.description === "string" ? body.description.trim() : ""

    if (!orderId) {
      return NextResponse.json({ error: "Missing order_id" }, { status: 400 })
    }
    if (!isProviderReportCategory(category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 })
    }
    if (description.length < 10) {
      return NextResponse.json(
        { error: "Description must be at least 10 characters" },
        { status: 400 },
      )
    }
    if (description.length > 2000) {
      return NextResponse.json(
        { error: "Description is too long" },
        { status: 400 },
      )
    }

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, customer_id, provider_id, status")
      .eq("id", orderId)
      .maybeSingle()

    if (orderError) throw orderError
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 })
    }

    if (String(order.customer_id) !== userId) {
      return NextResponse.json(
        { error: "Only the customer on this order can report the provider" },
        { status: 403 },
      )
    }

    const providerId = order.provider_id
      ? String(order.provider_id)
      : typeof body.provider_id === "string"
        ? body.provider_id.trim()
        : ""

    if (!providerId) {
      return NextResponse.json(
        { error: "This order has no assigned provider to report" },
        { status: 422 },
      )
    }

    const { data: provider, error: providerError } = await supabase
      .from("provider_details")
      .select("id")
      .eq("id", providerId)
      .maybeSingle()

    if (providerError) throw providerError
    if (!provider) {
      return NextResponse.json(
        { error: "Provider not found" },
        { status: 404 },
      )
    }

    const { data: existing } = await supabase
      .from("provider_reports")
      .select("id")
      .eq("reporter_id", userId)
      .eq("order_id", orderId)
      .eq("status", "open")
      .maybeSingle()

    if (existing) {
      return NextResponse.json(
        {
          error: "You already have an open report for this order",
          report_id: existing.id,
        },
        { status: 409 },
      )
    }

    const { data: report, error: insertError } = await supabase
      .from("provider_reports")
      .insert({
        reporter_id: userId,
        provider_id: providerId,
        order_id: orderId,
        category,
        description,
        status: "open",
      })
      .select("id, status, created_at")
      .single()

    if (insertError) throw insertError

    return NextResponse.json({
      ok: true,
      report: {
        id: report.id,
        status: report.status,
        created_at: report.created_at,
      },
    })
  } catch (error) {
    console.error("[reports/create]", error)
    return NextResponse.json(
      { error: "Failed to submit report" },
      { status: 500 },
    )
  }
}
