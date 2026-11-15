import { describe, expect, it } from "vitest";

import { contentSecurityPolicy, generateNonce } from "./security-headers";

const NONCE = "dGVzdC1ub25jZS0xMjM0NQ==";

/** The policy as `{ directive: [sources] }`, so a test reads one directive at a time. */
function directives(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .map((part) => {
        const [name = "", ...sources] = part.split(/\s+/);
        return [name, sources];
      }),
  );
}

describe("contentSecurityPolicy", () => {
  const production = directives(contentSecurityPolicy({ nonce: NONCE, development: false }));

  it("allows scripts only from the app itself and from the request's nonce", () => {
    expect(production["script-src"]).toEqual(["'self'", `'nonce-${NONCE}'`, "'strict-dynamic'"]);
  });

  it("has no unsafe-eval and no unsafe-inline in script-src in production", () => {
    const sources = production["script-src"] ?? [];

    expect(sources).not.toContain("'unsafe-eval'");
    expect(sources).not.toContain("'unsafe-inline'");
  });

  it("states every other directive of WS-041", () => {
    expect(production).toMatchObject({
      "default-src": ["'self'"],
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

  it("does not upgrade insecure requests, so a plain-http install still works", () => {
    expect(production).not.toHaveProperty("upgrade-insecure-requests");
  });

  it("adds 'unsafe-eval' to script-src in development, and changes nothing else", () => {
    const development = directives(contentSecurityPolicy({ nonce: NONCE, development: true }));

    expect(development["script-src"]).toEqual([
      ...(production["script-src"] ?? []),
      "'unsafe-eval'",
    ]);
    const { "script-src": _developed, ...restOfDevelopment } = development;
    const { "script-src": _produced, ...restOfProduction } = production;
    expect(restOfDevelopment).toEqual(restOfProduction);
  });

  it("is one line, with no newline", () => {
    expect(contentSecurityPolicy({ nonce: NONCE, development: false })).not.toMatch(/[\r\n]/);
  });
});

describe("generateNonce", () => {
  it("makes base64 values of at least 22 characters, all different", () => {
    const nonces = Array.from({ length: 1000 }, () => generateNonce());

    expect(new Set(nonces).size).toBe(1000);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22,}={0,2}$/);
    }
  });
});
