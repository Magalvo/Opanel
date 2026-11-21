import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
};

const integrationTests = "src/**/*.integration.test.ts";

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "unit",
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
          exclude: [integrationTests],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          globalSetup: ["./vitest.integration.global.ts"],
          setupFiles: ["./vitest.integration.setup.ts"],
          include: [integrationTests],
          // Integration tests share one database, so files run one at a time.
          fileParallelism: false,
        },
      },
      // The MCP server package (WS-099): Node, no database, its own dependencies.
      {
        resolve: { alias },
        test: {
          name: "mcp",
          environment: "node",
          include: ["mcp/src/**/*.test.ts"],
        },
      },
    ],
  },
});
