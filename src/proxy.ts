import { NextResponse, type NextRequest } from "next/server";
import { sessionCookieName, sessionCookieOptions } from "@/server/auth/cookie";

// Optimistic check only: redirects visitors without a session cookie and
// refreshes the cookie lifetime on navigation. The real verification (session
// in the database, membership, permissions) happens on the server for every
// page and action.

// The payment webhook has no session: the provider signature authenticates it.
const PUBLIC_PATHS = ["/entrar", "/criar-conta", "/api/health", "/api/pagamentos/webhook"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const token = request.cookies.get(sessionCookieName())?.value;
  const isPublic = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));

  if (!token && !isPublic && pathname !== "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/entrar";
    url.search = "";
    url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  const response = NextResponse.next();
  if (token && request.method === "GET") response.cookies.set(sessionCookieName(), token, sessionCookieOptions());
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
};
