import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// The PostHog add-on's unit tests (WS-092), apart from the app's Vitest projects: run with
// `pnpm exec vitest run --config addons/posthog/vitest.config.ts`.
export default defineConfig({
  root: fileURLToPath(new URL("./", import.meta.url)),
  resolve: {
    alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) },
  },
  test: {
    name: "addon-posthog",
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
