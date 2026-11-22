import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
};

const integrationTests = "src/**/*.integration.test.ts";

/** The `.ts` unit tests that need a DOM, so run under jsdom with the `.tsx` ones (WS-097). */
export const DOM_TEST_FILES = ["src/components/board/keyboard.test.ts"] as const;

/**
 * Integration files run in parallel, each worker on a database of its own (WS-097). Fixed,
 * locally and in CI: several worktrees may run at once, as for the end-to-end suite (WS-054).
 */
export const INTEGRATION_WORKERS = 4;

export default defineConfig({
  test: {
    projects: [
      // Unit tests that need no DOM, in Node (WS-097).
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          setupFiles: ["./vitest.setup.ts"],
          include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
          exclude: [integrationTests, ...DOM_TEST_FILES],
        },
      },
      // Components, and the few `.ts` files that need a DOM, under jsdom.
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "ui",
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts", "./vitest.setup.dom.ts"],
          include: ["src/**/*.test.tsx", ...DOM_TEST_FILES],
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
          maxWorkers: INTEGRATION_WORKERS,
          // Vitest runs projects with different `maxWorkers` in different groups: this one
          // starts once the unit, ui and mcp projects are done.
          sequence: { groupOrder: 1 },
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
