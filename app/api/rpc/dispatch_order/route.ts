import { NextResponse } from "next/server"
import { dispatchOrderById } from "@/lib/orders/dispatchOrder"

export async function POST(req: Request) {
  try {
    const { order_id } = (await req.json()) as { order_id: string }
    const result = await dispatchOrderById(order_id)

    if (!result.ok) {
      if (result.error === "ORDER_NOT_FOUND") {
        return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 })
      }
      if (result.error === "ORDER_NOT_DISPATCHABLE") {
        return NextResponse.json({ error: "ORDER_NOT_DISPATCHABLE" }, { status: 400 })
      }
      if (result.error === "SERVICE_NOT_FOUND") {
        return NextResponse.json({ error: "SERVICE_NOT_FOUND" }, { status: 404 })
      }
      if (result.error === "CUSTOMER_LOCATION_REQUIRED") {
        return NextResponse.json({ error: "CUSTOMER_LOCATION_REQUIRED" }, { status: 400 })
      }
      if (result.error === "OFFERS_INSERT_FAILED") {
        return NextResponse.json(
          {
            error: "OFFERS_INSERT_FAILED",
            detail: result.detail,
            code: result.code,
          },
          { status: 500 },
        )
      }
      if (result.error === "ORDER_UPDATE_FAILED") {
        return NextResponse.json(
          { error: "ORDER_UPDATE_FAILED", detail: result.detail, code: result.code },
          { status: 500 },
        )
      }
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    return NextResponse.json({ offers_count: result.offers_count, providers: result.providers })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[dispatch_order] unhandled:", e)
    return NextResponse.json(
      { error: "DISPATCH_ERROR", detail: process.env.NODE_ENV === "development" ? msg : undefined },
      { status: 500 },
    )
  }
}
