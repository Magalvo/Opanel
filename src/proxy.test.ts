import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { config, proxy } from "./proxy";

function page(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie === undefined ? {} : { Cookie: cookie },
  });
}

function redirectTarget(response: Response): string | null {
  return response.status === 307 ? response.headers.get("location") : null;
}

describe("proxy", () => {
  it("redirects a page request with no session cookie to /sign-in, remembering the page", () => {
    const response = proxy(page("/projects/1?tab=a"));

    expect(redirectTarget(response)).toBe(
      `http://localhost:3000/sign-in?next=${encodeURIComponent("/projects/1?tab=a")}`,
    );
  });

  it("redirects the home page without a next parameter that only repeats the default", () => {
    expect(redirectTarget(proxy(page("/")))).toBe("http://localhost:3000/sign-in?next=%2F");
  });

  it("lets a request through when either session cookie name is present", () => {
    expect(redirectTarget(proxy(page("/", "opanel.session_token=abc")))).toBeNull();
    expect(redirectTarget(proxy(page("/", "__Secure-opanel.session_token=abc")))).toBeNull();
  });

  it("does not take a look-alike cookie for a session", () => {
    expect(redirectTarget(proxy(page("/", "xopanel.session_token=abc")))).not.toBeNull();
  });

  it.each(["/sign-in", "/setup", "/accept", "/api/v1/health", "/api/v1/me"])(
    "never redirects %s, even with no cookie",
    (path) => {
      expect(redirectTarget(proxy(page(path)))).toBeNull();
    },
  );
});

describe("proxy: security headers (WS-041)", () => {
  const signedIn = "opanel.session_token=abc";

  function nonceOf(response: Response): string {
    const policy = response.headers.get("Content-Security-Policy") ?? "";
    return /'nonce-([^']+)'/.exec(policy)?.[1] ?? "";
  }

  it("puts the policy and X-Frame-Options on a page response", () => {
    const response = proxy(page("/", signedIn));

    expect(response.headers.get("Content-Security-Policy")).toContain("script-src 'self'");
    expect(nonceOf(response)).not.toBe("");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("hands the same policy and the nonce to the page being rendered", () => {
    const response = proxy(page("/", signedIn));

    // Next.js carries request-header overrides on the response in `x-middleware-request-*`.
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(nonceOf(response));
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(
      response.headers.get("Content-Security-Policy"),
    );
  });

  it("puts them on public pages and on the redirect to /sign-in as well", () => {
    for (const response of [proxy(page("/sign-in")), proxy(page("/projects/1"))]) {
      expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
      expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    }
    expect(redirectTarget(proxy(page("/projects/1")))).not.toBeNull();
  });

  it("uses a different nonce for every request", () => {
    const nonces = new Set(Array.from({ length: 50 }, () => nonceOf(proxy(page("/", signedIn)))));

    expect(nonces.size).toBe(50);
  });

  it("leaves API requests untouched", () => {
    const response = proxy(page("/api/v1/health"));

    expect(response.headers.get("Content-Security-Policy")).toBeNull();
    expect(response.headers.get("X-Frame-Options")).toBeNull();
    expect(response.headers.get("x-middleware-request-x-nonce")).toBeNull();
  });
});

describe("proxy matcher", () => {
  const matcher = new RegExp(`^${config.matcher}$`);

  it("skips static assets and the favicon", () => {
    for (const path of ["/_next/static/chunk.js", "/_next/image", "/favicon.ico"]) {
      expect(matcher.test(path)).toBe(false);
    }
  });

  it("runs on app pages", () => {
    for (const path of ["/", "/projects", "/projects/1"]) {
      expect(matcher.test(path)).toBe(true);
    }
  });
});
