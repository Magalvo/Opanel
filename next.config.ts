import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // `next dev` otherwise appends its own block to AGENTS.md, which is the
  // owner-approved project constitution. See WS-001, "Deviations".
  agentRules: false,
};

export default nextConfig;
