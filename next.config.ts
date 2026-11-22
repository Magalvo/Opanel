import type { NextConfig } from "next";
import { z } from "zod";

/**
 * Set to "1" by the end-to-end run only (WS-103): its `next build` skips Next.js's own
 * TypeScript step, because the quality gate has just run `pnpm typecheck`, route types
 * included. `pnpm build` and the image build leave it unset and keep the check. Defined
 * here, not in a module of its own, because the runtime image ships this file alone.
 */
export const BUILD_SKIP_TYPECHECK = "OPANEL_BUILD_SKIP_TYPECHECK";

/** Validated at the boundary (AGENTS.md hard rule 4): "1" or unset. */
export function buildSkipsTypecheck(env: Readonly<Record<string, string | undefined>>): boolean {
  const parsed = z.enum(["1"]).optional().safeParse(env[BUILD_SKIP_TYPECHECK]);
  if (!parsed.success) {
    throw new Error(`${BUILD_SKIP_TYPECHECK} must be "1" or unset.`);
  }
  return parsed.data === "1";
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  typescript: { ignoreBuildErrors: buildSkipsTypecheck(process.env) },
  // `next dev` otherwise appends its own block to AGENTS.md, which is the
  // owner-approved project constitution. See WS-001, "Deviations".
  agentRules: false,
  // On every response, pages and API alike (WS-041). The page-only headers, the Content
  // Security Policy among them, are set by the proxy with a per-request nonce.
  headers() {
    return Promise.resolve([
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ]);
  },
};

export default nextConfig;
