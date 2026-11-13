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
