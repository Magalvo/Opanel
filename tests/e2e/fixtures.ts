// Specs that need a signed-in person import `test` from here instead of Playwright.
import { expect, test as base } from "@playwright/test";

import { E2E_BASE_URL } from "./environment";
import { seedAccount } from "./seed";

export const PASSWORD = "an e2e password, long enough";

interface Fixtures {
  account: { email: string; password: string };
}

export const test = base.extend<Fixtures>({
  account: async ({ browserName: _browserName }, provide) => {
    const email = `e2e-${crypto.randomUUID()}@example.com`;
    await seedAccount({ email, password: PASSWORD, role: "member" });
    await provide({ email, password: PASSWORD });
  },

  // The page's own request context shares its cookie jar, so the browser is signed in.
  page: async ({ page, account }, provide) => {
    const response = await page.request.post("/api/v1/auth/sign-in", {
      headers: { Origin: E2E_BASE_URL },
      data: account,
    });
    expect(response.status()).toBe(200);
    await provide(page);
  },
});

export { expect };
