import { type NextRequest, NextResponse } from "next/server";

import { contentSecurityPolicy, generateNonce } from "@/lib/security-headers";
import { SESSION_COOKIE_NAMES } from "@/lib/session-cookie";

const PUBLIC_PATHS = ["/sign-in", "/setup", "/accept"];

function isPublic(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
  );
}

/**
 * Two jobs on every page request (the API is left alone):
 *
 * 1. The Content Security Policy with a nonce of its own for the request (WS-041). The policy
 *    and the nonce go on the request too, so Next.js stamps the nonce on its own scripts, and
 *    `X-Frame-Options` goes on the response for browsers that predate `frame-ancestors`.
 * 2. The optimistic check of WS-017: a page request with no session cookie is sent to the
 *    sign-in page, remembering where it was going. It reads the cookie's presence only, never
 *    the database, as the Next.js documentation advises for a proxy. It is a convenience, not
 *    a security boundary: the `(app)` layout verifies the session and the API authenticates
 *    every request.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  // JSON is never rendered as a page, so it has no use for the policy.
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const nonce = generateNonce();
  const policy = contentSecurityPolicy({
    nonce,
    development: process.env.NODE_ENV === "development",
  });

  let response: NextResponse;
  if (isPublic(pathname) || SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name))) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", policy);
    response = NextResponse.next({ request: { headers: requestHeaders } });
  } else {
    const signIn = new URL("/sign-in", request.url);
    signIn.searchParams.set("next", `${pathname}${search}`);
    response = NextResponse.redirect(signIn);
  }

  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("X-Frame-Options", "DENY");
  return response;
}

export const config = {
  // Static assets never need a session.
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
