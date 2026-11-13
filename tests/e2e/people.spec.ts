import { expect, type Page, test as base } from "@playwright/test";

import { E2E_BASE_URL } from "./environment";
import { expect as expectSigned, test as member } from "./fixtures";
import { seedAccount } from "./seed";

const password = "an e2e admin password, long";

const admin = base.extend({
  page: async ({ page }, provide) => {
    const email = `admin-${crypto.randomUUID()}@example.com`;
    await seedAccount({ email, password, role: "admin" });
    const response = await page.request.post("/api/v1/auth/sign-in", {
      headers: { Origin: E2E_BASE_URL },
      data: { email, password },
    });
    expect(response.status()).toBe(200);
    await provide(page);
  },
});

/** The end-to-end database keeps every account of the run, so the newest may be on page two. */
async function showEveryone(page: Page) {
  const more = page.getByRole("button", { name: "Load more" });
  while (await more.isVisible()) {
    await more.click();
  }
}

admin(
  "an Admin invites, changes a role, deactivates and reactivates from the People page",
  async ({ page }) => {
    await page.goto("/people");
    await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();

    const email = `grace-${crypto.randomUUID()}@example.com`;
    await page.getByRole("button", { name: "Invite person" }).click();
    const dialog = page.getByRole("dialog", { name: "Invite a person" });
    await dialog.getByLabel("Name").fill("Grace Hopper");
    await dialog.getByLabel("Email").fill(email);
    await dialog.getByRole("button", { name: "Create invitation" }).click();

    const linkDialog = page.getByRole("dialog", { name: "Invitation link" });
    await expect(linkDialog.getByLabel("Link")).toHaveValue(/\/accept#[A-Za-z0-9_-]{43,}$/);
    await linkDialog.getByRole("button", { name: "Done" }).click();

    await showEveryone(page);
    const row = page.getByRole("row", { name: new RegExp(email) });
    await expect(row.getByText("Invited")).toBeVisible();

    await row.getByRole("combobox").click();
    await page.getByRole("option", { name: "Manager" }).click();
    await expect(page.getByRole("status")).toContainText("role is now Manager");
    await expect(row.getByRole("combobox")).toHaveText("Manager");

    await row.getByRole("button", { name: /^Actions for/ }).click();
    await page.getByRole("menuitem", { name: "Deactivate" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Deactivate" }).click();
    await expect(row.getByText("Deactivated")).toBeVisible();

    await row.getByRole("button", { name: /^Actions for/ }).click();
    await page.getByRole("menuitem", { name: "Reactivate" }).click();
    await expect(row.getByText("Invited")).toBeVisible();
  },
);

admin("the page fits a phone and renders in the dark theme", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/people");
  await expect(page.getByRole("table")).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Invite person" }).click();
  await expect(page.getByRole("dialog", { name: "Invite a person" })).toBeVisible();
});

member("a Member does not see People and gets a not-found page at /people", async ({ page }) => {
  await page.goto("/");
  await expectSigned(page.getByRole("button", { name: "Account menu" })).toBeVisible();
  await expectSigned(page.getByRole("link", { name: "People" })).toHaveCount(0);

  const response = await page.goto("/people");

  expect(response?.status()).toBe(404);
});
