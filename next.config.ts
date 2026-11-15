import type { NextConfig } from "next";

import { STATIC_SECURITY_HEADERS } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // `next dev` otherwise appends its own block to AGENTS.md, which is the
  // owner-approved project constitution. See WS-001, "Deviations".
  agentRules: false,
  // Every response, pages and API alike. The policy itself needs a nonce per request, so it
  // is added by `src/proxy.ts` (WS-041).
  headers() {
    return Promise.resolve([{ source: "/:path*", headers: [...STATIC_SECURITY_HEADERS] }]);
  },
};

export default nextConfig;
