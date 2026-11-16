import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
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
