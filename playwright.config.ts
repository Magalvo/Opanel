import { defineConfig, devices } from "@playwright/test";

import { E2E_AUTH_SECRET, E2E_BASE_URL, E2E_DATABASE_URL, E2E_PORT } from "./tests/e2e/environment";

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  outputDir: "./test-results",

  fullyParallel: true,
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
  ],

  // The app under test is the production build, running against its own database.
  webServer: {
    command: `tsx tests/e2e/prepare.ts && next build && next start -p ${String(E2E_PORT)}`,
    url: `${E2E_BASE_URL}/api/v1/health`,
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      BETTER_AUTH_SECRET: E2E_AUTH_SECRET,
      APP_URL: E2E_BASE_URL,
    },
    // Never reuse a server that is already listening: it could be serving an older build,
    // and the tests would pass or fail against the wrong code.
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
