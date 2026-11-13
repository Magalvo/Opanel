import { expect, request as playwrightRequest } from "@playwright/test";

import { E2E_BASE_URL } from "./environment";
import { test } from "./fixtures";

const newPassword = "my new e2e password, long";
const origin = { Origin: E2E_BASE_URL };

test("a Member renames themselves and changes their password; their other browser is signed out", async ({
  page,
  account,
  browser,
}) => {
  // A second browser, signed in as the same person.
  const elsewhere = await browser.newContext({ baseURL: E2E_BASE_URL });
  try {
    expect(
      (
        await elsewhere.request.post("/api/v1/auth/sign-in", { headers: origin, data: account })
      ).status(),
    ).toBe(200);

    await page.goto("/");
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Profile" }).click();
    await expect(page).toHaveURL(`${E2E_BASE_URL}/profile`);

    await page.getByLabel("Name").fill("Ada Renamed");
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.getByRole("menu").getByText("Ada Renamed")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByLabel("Current password").fill(account.password);
    await page.getByLabel("New password", { exact: true }).fill(newPassword);
    await page.getByLabel("Confirm new password").fill(newPassword);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(
      page.getByText("Password changed. You were signed out on your other devices."),
    ).toBeVisible();

    // This browser is still signed in; the other one is not.
    expect((await page.request.get("/api/v1/me")).status()).toBe(200);
    expect((await elsewhere.request.get("/api/v1/me")).status()).toBe(401);
  } finally {
    await elsewhere.close();
  }

  // The old password no longer signs in; the new one does.
  const fresh = await playwrightRequest.newContext({ baseURL: E2E_BASE_URL });
  try {
    const signIn = (password: string) =>
      fresh.post("/api/v1/auth/sign-in", {
        headers: origin,
        data: { email: account.email, password },
      });
    expect((await signIn(account.password)).status()).toBe(401);
    expect((await signIn(newPassword)).status()).toBe(200);
  } finally {
    await fresh.dispose();
  }
});
