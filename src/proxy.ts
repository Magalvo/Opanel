import { type NextRequest, NextResponse } from "next/server";

import {
  contentSecurityPolicy,
  createNonce,
  strictTransportSecurity,
} from "@/lib/security-headers";
import { SESSION_COOKIE_NAMES } from "@/lib/session-cookie";
import { getEnv, getNodeEnv } from "@/server/env";

const PUBLIC_PATHS = ["/sign-in", "/setup", "/accept"];

function isApi(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function withPageHeaders(response: NextResponse, policy: string, appUrl: string): NextResponse {
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("X-Frame-Options", "DENY");
  const hsts = strictTransportSecurity(appUrl);
  if (hsts !== null) response.headers.set("Strict-Transport-Security", hsts);
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
  return handleProxy(request, getEnv().APP_URL);
}

/**
 * The proxy's work, with the app's public address given (WS-067: it decides
 * `Strict-Transport-Security`). Exported for the tests.
 */
export function handleProxy(request: NextRequest, appUrl: string): NextResponse {
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
    return withPageHeaders(NextResponse.next({ request: { headers } }), policy, appUrl);
  }

  const signIn = new URL("/sign-in", request.url);
  signIn.searchParams.set("next", `${pathname}${search}`);
  return withPageHeaders(NextResponse.redirect(signIn), policy, appUrl);
}

export const config = {
  // Static assets need neither a session nor a policy. API requests never enter the proxy:
  // with a proxy in place Next.js buffers each request body in memory (up to 10 MB) before
  // the route reads it, and the API bounds its bodies itself (WS-044).
  matcher: "/((?!api/|_next/static|_next/image|favicon.ico).*)",
};
