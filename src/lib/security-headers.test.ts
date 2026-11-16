import { describe, expect, it } from "vitest";

import { contentSecurityPolicy, createNonce } from "./security-headers";

/** The policy as a map from directive name to its values. */
function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .map((part) => {
        const [name = "", ...values] = part.split(/\s+/);
        return [name, values];
      }),
  );
}

describe("contentSecurityPolicy", () => {
  it("has every directive of WS-041 with the given nonce, in production", () => {
    const policy = directives(contentSecurityPolicy({ nonce: "abc123==", development: false }));

    expect(Object.fromEntries(policy)).toEqual({
      "default-src": ["'self'"],
      "script-src": ["'self'", "'nonce-abc123=='", "'strict-dynamic'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "img-src": ["'self'", "blob:", "data:"],
      "font-src": ["'self'"],
      "connect-src": ["'self'"],
      "object-src": ["'none'"],
      "base-uri": ["'self'"],
      "form-action": ["'self'"],
      "frame-ancestors": ["'none'"],
    });
  });

  it("never allows eval or inline scripts in production", () => {
    const scripts = directives(contentSecurityPolicy({ nonce: "n", development: false })).get(
      "script-src",
    );

    expect(scripts).not.toContain("'unsafe-eval'");
    expect(scripts).not.toContain("'unsafe-inline'");
  });

  it("adds only 'unsafe-eval' to script-src in development", () => {
    const production = directives(contentSecurityPolicy({ nonce: "n", development: false }));
    const development = directives(contentSecurityPolicy({ nonce: "n", development: true }));

    expect(development.get("script-src")).toEqual([
      ...(production.get("script-src") ?? []),
      "'unsafe-eval'",
    ]);
    development.delete("script-src");
    production.delete("script-src");
    expect(development).toEqual(production);
  });

  it("is a single line", () => {
    expect(contentSecurityPolicy({ nonce: "n", development: false })).not.toMatch(/[\r\n]/);
  });
});

describe("createNonce", () => {
  it("gives 1 000 different base64 nonces of at least 22 characters", () => {
    const nonces = Array.from({ length: 1000 }, () => createNonce());

    expect(new Set(nonces).size).toBe(1000);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
      expect(nonce.length).toBeGreaterThanOrEqual(22);
    }
  });
});
