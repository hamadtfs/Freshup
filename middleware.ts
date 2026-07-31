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
]);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const slug = pathname.replace(/^\/+|\/+$/g, "");

  if (APP_SUBPAGES.has(slug)) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next|favicon.ico).*)"],
};
