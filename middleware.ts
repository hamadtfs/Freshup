import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const APP_SUBPAGES = new Set([
  "profile",
  "orders",
  "support",
  "support-chat",
  "about",
  "payment",
  "earnings",
  "wallet",
  "skills",
  "chat",
  "report",
  "admin",
]);

function withNoIndex(res: NextResponse): NextResponse {
  // Temporary/public deploys must not be indexed (client requirement).
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const slug = pathname.replace(/^\/+|\/+$/g, "");

  if (APP_SUBPAGES.has(slug)) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return withNoIndex(NextResponse.rewrite(url));
  }

  return withNoIndex(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
