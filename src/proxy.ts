import { NextResponse, type NextRequest } from "next/server";
import { PIN_COOKIE, pinRequired, pinToken } from "@/lib/auth";

/** Shared-PIN gate for deployed instances (APP_PIN). /api/cron has its own CRON_SECRET check. */
export function proxy(request: NextRequest) {
  if (!pinRequired() || request.cookies.get(PIN_COOKIE)?.value === pinToken()) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) return Response.json({ error: "Ingresa el PIN." }, { status: 401 });
  const url = new URL("/login", request.url);
  url.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|assets/|login|api/login|api/cron).*)"],
};
