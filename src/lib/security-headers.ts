// The Content Security Policy of every page (WS-041). Pure, so it is tested without a
// server; the proxy builds it per request with a fresh nonce.

/**
 * The policy for a page. Scripts run only with the request's nonce (`'strict-dynamic'`
 * lets those scripts load the app's own chunks); inline styles are allowed, see WS-041
 * section 3. In development React needs `eval` for its debugging aids, and only there.
 */
export function contentSecurityPolicy({
  nonce,
  development,
}: {
  nonce: string;
  development: boolean;
}): string {
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    [
      "script-src",
      ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(development ? ["'unsafe-eval'"] : [])],
    ],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "blob:", "data:"]],
    ["font-src", ["'self'"]],
    ["connect-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

/** 16 random bytes, base64: unpredictable, and new for every request. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * `Strict-Transport-Security` for an install served over HTTPS (WS-067): one year, without
 * `includeSubDomains` or `preload`, which only the operator can decide. `APP_URL` is the
 * operator's statement of the public address, so it decides; null for an `http:` one.
 */
export function strictTransportSecurity(appUrl: string): string | null {
  return new URL(appUrl).protocol === "https:" ? "max-age=31536000" : null;
}
