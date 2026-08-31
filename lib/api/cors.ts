import { NextResponse } from "next/server"

const DEFAULT_ALLOWED_ORIGINS = [
  "https://freshup.app",
  "https://www.freshup.app",
]

function allowedOrigins(): string[] {
  const extra = String(process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  return [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...extra])]
}

export function corsOrigin(req: Request): string | null {
  const origin = req.headers.get("origin")
  if (!origin) return null
  if (allowedOrigins().includes(origin)) return origin
  // Local website / marketing site development
  if (
    process.env.NODE_ENV === "development" &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
  ) {
    return origin
  }
  return null
}

export function withCorsHeaders(
  req: Request,
  res: NextResponse,
): NextResponse {
  const origin = corsOrigin(req)
  if (origin) {
    res.headers.set("Access-Control-Allow-Origin", origin)
    res.headers.set("Vary", "Origin")
    res.headers.set("Access-Control-Allow-Credentials", "true")
    res.headers.set(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, x-provider-id, x-user-id",
    )
    res.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
  }
  return res
}

export function corsPreflight(req: Request): NextResponse {
  const res = new NextResponse(null, { status: 204 })
  return withCorsHeaders(req, res)
}
