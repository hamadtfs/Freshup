import { NextResponse } from "next/server"

export async function POST() {
  // Stub endpoint ready for Stripe integration
  return NextResponse.json({ ok: true, provider: "stripe", status: "authorized" })
}
