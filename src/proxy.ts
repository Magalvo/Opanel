import { type NextRequest, NextResponse } from "next/server";

import { contentSecurityPolicy, createNonce } from "@/lib/security-headers";
import { SESSION_COOKIE_NAMES } from "@/lib/session-cookie";
import { getNodeEnv } from "@/server/env";

const PUBLIC_PATHS = ["/sign-in", "/setup", "/accept"];

function isApi(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function withPageHeaders(response: NextResponse, policy: string): NextResponse {
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("X-Frame-Options", "DENY");
  return response;
}

/**
 * Every page request (WS-017, WS-041):
 *
 * - gets a Content Security Policy with a fresh nonce. The policy and the nonce are also
 *   put on the forwarded request, where Next.js reads the nonce to stamp its own scripts
 *   and the root layout reads it for the theme script;
 * - with no session cookie, is sent to the sign-in page, remembering where it was going.
 *   This reads the cookie's presence only, never the database, as the Next.js
 *   documentation advises for a proxy. It is a convenience, not a security boundary: the
 *   `(app)` layout verifies the session and the API authenticates every request.
 *
 * API requests pass through untouched: they are JSON, never rendered as a page.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  if (isApi(pathname)) {
    return NextResponse.next();
  }

  const nonce = createNonce();
  const policy = contentSecurityPolicy({
    nonce,
    development: getNodeEnv() === "development",
  });

  if (isPublic(pathname) || SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name))) {
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    headers.set("Content-Security-Policy", policy);
    return withPageHeaders(NextResponse.next({ request: { headers } }), policy);
  }

  const signIn = new URL("/sign-in", request.url);
  signIn.searchParams.set("next", `${pathname}${search}`);
  return withPageHeaders(NextResponse.redirect(signIn), policy);
}

export const config = {
  // Static assets need neither a session nor a policy.
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
