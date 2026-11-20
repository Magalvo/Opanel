import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

import {
  E2E_APP_DATABASE_URL,
  E2E_AUTH_SECRET,
  E2E_DATABASE_URL,
  E2E_SETUP_TOKEN,
} from "../../tests/e2e/environment";
import { ADDON_BASE_URL, ADDON_PORT } from "./e2e/environment";

// The PostHog add-on's end-to-end test (WS-092 section 4): the production build of the
// app, started as the app's own playwright.config.ts starts it, on the add-on's port. Run
// with `pnpm exec playwright test --config addons/posthog/playwright.config.ts`.

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  outputDir: "./test-results",
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: "list",

  use: { baseURL: ADDON_BASE_URL },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    command: `tsx tests/e2e/prepare.ts && next build && next start -p ${String(ADDON_PORT)}`,
    url: `${ADDON_BASE_URL}/api/v1/health`,
    env: {
      DATABASE_URL: E2E_APP_DATABASE_URL,
      MIGRATION_DATABASE_URL: E2E_DATABASE_URL,
      BETTER_AUTH_SECRET: E2E_AUTH_SECRET,
      APP_URL: ADDON_BASE_URL,
      SETUP_TOKEN: E2E_SETUP_TOKEN,
    },
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
