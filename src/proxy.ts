import { type NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE_NAMES } from "@/lib/session-cookie";

const PUBLIC_PATHS = ["/sign-in", "/setup", "/accept"];

function isPublic(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
  );
}

/**
 * The optimistic check of WS-017: a page request with no session cookie is sent to the
 * sign-in page, remembering where it was going. It reads the cookie's presence only, never
 * the database, as the Next.js documentation advises for a proxy. It is a convenience, not
 * a security boundary: the `(app)` layout verifies the session and the API authenticates
 * every request.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  if (isPublic(pathname) || SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name))) {
    return NextResponse.next();
  }

  const signIn = new URL("/sign-in", request.url);
  signIn.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(signIn);
}

export const config = {
  // Static assets never need a session.
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
