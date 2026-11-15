/**
 * The Content Security Policy of every page (WS-041, WI-041). It is built here, as a plain
 * function, so a test can read it without a server; `src/proxy.ts` puts it on each request.
 */

/** 16 random bytes as base64: unpredictable, and different on every request. */
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export interface PolicyOptions {
  nonce: string;
  /** `next dev` needs `'unsafe-eval'` for React's debugging; production never has it. */
  development: boolean;
}

export function contentSecurityPolicy({ nonce, development }: PolicyOptions): string {
  const scriptSources = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(development ? ["'unsafe-eval'"] : []),
  ];
  const directives: Record<string, readonly string[]> = {
    "default-src": ["'self'"],
    "script-src": scriptSources,
    // Inline styles are allowed (WS-041 section 3): the sidebar and the drag-and-drop
    // library set `style` attributes. This does not allow scripts.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "blob:", "data:"],
    "font-src": ["'self'"],
    "connect-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");
}

/** Sent on every response, pages and API alike (`next.config.ts`). */
export const STATIC_SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
] as const;
