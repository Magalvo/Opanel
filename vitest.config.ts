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
          include: ["src/**/*.test.{ts,tsx}"],
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
    ],
  },
});
