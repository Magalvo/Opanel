import { defineConfig, devices } from "@playwright/test";

import {
  E2E_APP_DATABASE_URL,
  E2E_AUTH_SECRET,
  E2E_BASE_URL,
  E2E_DATABASE_URL,
  E2E_PORT,
  E2E_SETUP_TOKEN,
} from "./tests/e2e/environment";

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  outputDir: "./test-results",

  fullyParallel: true,
  // Locally at most 4 workers: with more, a busy machine serves the app's JavaScript too
  // slowly and tests time out (WS-054). CI keeps Playwright's default.
  ...(isCI ? {} : { workers: 4 }),
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : "list",

  use: {
    baseURL: E2E_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    // First-run setup needs an install with no accounts, so it runs alone and first. The
    // other specs seed their own accounts and wait for it (WS-016).
    {
      name: "first-run",
      testMatch: "**/setup.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    // A test that changes install-wide state other tests rely on runs here, alone, after
    // first-run and before every other test (WS-052). Today: the last-Admin check, which
    // deactivates every other Admin.
    {
      name: "exclusive",
      testMatch: "**/last-admin.spec.ts",
      dependencies: ["first-run"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      testIgnore: ["**/setup.spec.ts", "**/last-admin.spec.ts"],
      dependencies: ["exclusive"],
      use: { ...devices["Desktop Chrome"] },
    },
    // The MCP server package (WS-099): its built server over stdio against this app. No
    // browser. `pnpm test:e2e` builds the package first.
    {
      name: "mcp",
      testDir: "./mcp/e2e",
      dependencies: ["exclusive"],
    },
  ],

  // The app under test is the production build, running against its own database.
  webServer: {
    command: `tsx tests/e2e/prepare.ts && next build && next start -p ${String(E2E_PORT)}`,
    url: `${E2E_BASE_URL}/api/v1/health`,
    env: {
      // The app connects as the runtime role, `prepare.ts` and `migrate` as the owner (WS-063).
      DATABASE_URL: E2E_APP_DATABASE_URL,
      MIGRATION_DATABASE_URL: E2E_DATABASE_URL,
      BETTER_AUTH_SECRET: E2E_AUTH_SECRET,
      APP_URL: E2E_BASE_URL,
      SETUP_TOKEN: E2E_SETUP_TOKEN,
    },
    // Never reuse a server that is already listening: it could be serving an older build,
    // and the tests would pass or fail against the wrong code.
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
