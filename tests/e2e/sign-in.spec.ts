import { expect, test } from "@playwright/test";

import { test as signedIn } from "./fixtures";
import { ageSessions, seedAccount, sessionExpiry } from "./seed";

const password = "an e2e password, long enough";

test.describe("the sign-in page", () => {
  test("a wrong password shows one generic error; the right one shows the app", async ({
    page,
  }) => {
    const email = `e2e-${crypto.randomUUID()}@example.com`;
    await seedAccount({ email, password, role: "member" });
    await page.goto("/sign-in");

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("not the right password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Invalid email or password.")).toBeVisible();

    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
  });

  test("opening an app page while signed out returns to it after signing in", async ({ page }) => {
    const email = `e2e-${crypto.randomUUID()}@example.com`;
    await seedAccount({ email, password, role: "member" });

    await page.goto("/?from=test");
    await expect(page).toHaveURL(/\/sign-in\?next=/);

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL("/?from=test");
  });

  test("a return address outside the app is ignored", async ({ page }) => {
    const email = `e2e-${crypto.randomUUID()}@example.com`;
    await seedAccount({ email, password, role: "member" });
    await page.goto("/sign-in?next=//evil.example");

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL("/");
  });

  test("health, the OpenAPI document and the sign-in page stay reachable without a session", async ({
    request,
  }) => {
    expect((await request.get("/api/v1/health")).status()).toBe(200);
    expect((await request.get("/api/v1/openapi.json")).status()).toBe(200);
    expect((await request.get("/sign-in")).status()).toBe(200);
  });
});

signedIn.describe("the account menu", () => {
  signedIn(
    "signing out leads to /sign-in and the back button does not show the app",
    async ({ page, account }) => {
      await page.goto("/");
      await page.getByRole("button", { name: "Account menu" }).click();
      await expect(page.getByText(account.email)).toBeVisible();

      await page.getByRole("menuitem", { name: "Sign out" }).click();
      await expect(page).toHaveURL(/\/sign-in/);

      await page.goBack();
      await expect(page).toHaveURL(/\/sign-in/);
      await expect(page.getByRole("button", { name: "Account menu" })).toHaveCount(0);
    },
  );

  signedIn(
    "loading the app extends a session that is more than a day old",
    async ({ page, account }) => {
      await ageSessions(account.email, 5);
      const before = await sessionExpiry(account.email);

      await page.goto("/");

      await expect
        .poll(async () => (await sessionExpiry(account.email)).getTime())
        .toBeGreaterThan(before.getTime() + 4 * 24 * 60 * 60 * 1000);
    },
  );
});
