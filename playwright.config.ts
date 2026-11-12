import { defineConfig, devices } from "@playwright/test";

import { E2E_BASE_URL, E2E_DATABASE_URL, E2E_PORT } from "./tests/e2e/environment";

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

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  // The app under test is the production build, running against its own database.
  webServer: {
    command: `tsx tests/e2e/prepare.ts && next build && next start -p ${String(E2E_PORT)}`,
    url: `${E2E_BASE_URL}/api/v1/health`,
    env: { DATABASE_URL: E2E_DATABASE_URL },
    reuseExistingServer: !isCI,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
