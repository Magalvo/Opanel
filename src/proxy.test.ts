import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { config, handleProxy } from "./proxy";

const HTTP_APP = "http://localhost:3000";

function proxy(request: NextRequest) {
  return handleProxy(request, HTTP_APP);
}

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

/** The nonce in a `script-src 'nonce-...'` source of a policy. */
function nonceOf(policy: string | null): string | null {
  return /'nonce-([^']+)'/.exec(policy ?? "")?.[1] ?? null;
}

/** A request header the proxy forwards to the page, as `NextResponse.next` encodes it. */
function forwarded(response: Response, name: string): string | null {
  return response.headers.get(`x-middleware-request-${name}`);
}

describe("proxy: Content Security Policy (WS-041)", () => {
  it("gives a page its policy with a nonce, and X-Frame-Options: DENY", () => {
    const response = proxy(page("/projects", "opanel.session_token=abc"));
    const policy = response.headers.get("content-security-policy");

    expect(policy).toContain("frame-ancestors 'none'");
    expect(nonceOf(policy)).not.toBeNull();
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  it("forwards the policy and the nonce on the request, so Next.js stamps its scripts", () => {
    const response = proxy(page("/sign-in"));
    const nonce = nonceOf(response.headers.get("content-security-policy"));

    expect(nonce).not.toBeNull();
    expect(forwarded(response, "x-nonce")).toBe(nonce);
    expect(forwarded(response, "content-security-policy")).toBe(
      response.headers.get("content-security-policy"),
    );
  });

  it("puts the same headers on the redirect to /sign-in", () => {
    const response = proxy(page("/projects"));

    expect(redirectTarget(response)).not.toBeNull();
    expect(nonceOf(response.headers.get("content-security-policy"))).not.toBeNull();
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  it("gives every request a different nonce", () => {
    const first = nonceOf(proxy(page("/sign-in")).headers.get("content-security-policy"));
    const second = nonceOf(proxy(page("/sign-in")).headers.get("content-security-policy"));

    expect(first).not.toBe(second);
  });

  it("passes API requests through untouched", () => {
    const response = proxy(page("/api/v1/health"));

    expect(response.headers.get("content-security-policy")).toBeNull();
    expect(response.headers.get("x-frame-options")).toBeNull();
    expect(response.headers.get("x-middleware-override-headers")).toBeNull();
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
    for (const path of ["/", "/projects", "/projects/1", "/apiary", "/api-docs"]) {
      expect(matcher.test(path), path).toBe(true);
    }
  });

  it("never runs for the API, so Next.js does not buffer API request bodies (WS-044)", () => {
    for (const path of ["/api/v1/health", "/api/v1/tasks/OPA-1", "/api/v1/auth/sign-in"]) {
      expect(matcher.test(path), path).toBe(false);
    }
  });
});

describe("proxy: Strict-Transport-Security (WS-067)", () => {
  it("is on a page and on a redirect when APP_URL is https:", () => {
    const signedIn = handleProxy(
      page("/", "opanel.session_token=abc"),
      "https://opanel.example.com",
    );
    const redirected = handleProxy(page("/projects"), "https://opanel.example.com");

    expect(signedIn.headers.get("Strict-Transport-Security")).toBe("max-age=31536000");
    expect(redirected.headers.get("Strict-Transport-Security")).toBe("max-age=31536000");
  });

  it("is not there when APP_URL is http:", () => {
    expect(proxy(page("/sign-in")).headers.get("Strict-Transport-Security")).toBeNull();
    expect(proxy(page("/projects")).headers.get("Strict-Transport-Security")).toBeNull();
  });
});
