import type { Page } from "@playwright/test";

import { expect, test } from "./base";
import { E2E_BASE_URL } from "./environment";
import { seedAccount } from "./seed";

const password = "an e2e projects password, long";
const headers = { Origin: E2E_BASE_URL };

async function signInAs(page: Page, role: "manager" | "viewer"): Promise<void> {
  const id = crypto.randomUUID().slice(0, 8);
  const email = `${role}-${id}@example.com`;
  await seedAccount({ email, password, role, name: `${role} ${id}` });
  const response = await page.request.post("/api/v1/auth/sign-in", {
    headers,
    data: { email, password },
  });
  expect(response.status()).toBe(200);
}

/** A key no other test of the run uses: "P" and seven random letters and digits. */
function uniqueKey(): string {
  return `P${crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
}

async function createProjectThroughApi(page: Page, key: string, name = key): Promise<void> {
  const response = await page.request.post("/api/v1/projects", {
    headers,
    data: { key, name },
  });
  expect(response.status()).toBe(201);
}

test("a Manager creates a project, edits it and its columns, and archives it", async ({ page }) => {
  await signInAs(page, "manager");
  const key = uniqueKey();

  await page.goto("/");
  const main = page.getByRole("navigation", { name: "Main" });
  await main.getByRole("link", { name: "Projects" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();

  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Key").fill(key.toLowerCase());
  await dialog.getByLabel("Name").fill(`Project ${key}`);
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${key}$`));
  await expect(page.getByRole("heading", { level: 1, name: `Project ${key}` })).toBeVisible();

  await page
    .getByRole("navigation", { name: "Project" })
    .getByRole("link", { name: "Settings" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/projects/${key}/settings$`));

  const details = page.getByRole("region", { name: "Details" });
  await details.getByLabel("Description").fill("What we build.");
  await details.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Saved.");

  await page.getByRole("button", { name: "Add column" }).click();
  const add = page.getByRole("dialog", { name: "Add a column" });
  await add.getByLabel("Name").fill("Review");
  await add.getByLabel("Category").selectOption({ label: "In progress" });
  await add.getByRole("button", { name: "Add column" }).click();
  const columns = page.getByRole("region", { name: "Columns" });
  await expect(columns.getByRole("row", { name: /Review/ })).toBeVisible();

  await page.getByRole("button", { name: "Move Review up" }).click();
  await expect(columns.getByRole("row").nth(3)).toContainText("Review");

  await page.getByRole("button", { name: "Edit Review" }).click();
  const edit = page.getByRole("dialog", { name: "Edit column" });
  await edit.getByLabel("Name").fill("Code review");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(columns.getByRole("row", { name: /Code review/ })).toBeVisible();

  await page.getByRole("button", { name: "Delete Code review" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(columns.getByRole("row", { name: /Code review/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Delete Done" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("status")).toContainText("A project needs at least one Done column.");

  await page.getByRole("button", { name: "Archive project" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("This project is archived, so it is read-only.")).toBeVisible();
  await page.goto("/projects?view=archived");
  await expect(page.getByRole("link", { name: `Project ${key}` })).toBeVisible();

  await page.goto(`/projects/${key}/settings`);
  await page.getByRole("button", { name: "Unarchive project" }).click();
  await expect(page.getByRole("status")).toContainText(`${key} was unarchived.`);
});

test("a deleted task is restored from the settings page", async ({ page }) => {
  await signInAs(page, "manager");
  const key = uniqueKey();
  await createProjectThroughApi(page, key);
  const created = await page.request.post(`/api/v1/projects/${key}/tasks`, {
    headers,
    data: { title: "Brought back" },
  });
  expect(created.status()).toBe(201);
  expect((await page.request.delete(`/api/v1/tasks/${key}-1`, { headers })).status()).toBe(204);

  await page.goto(`/projects/${key}/settings`);
  await page.getByRole("button", { name: `Restore ${key}-1` }).click();
  await expect(page.getByRole("status")).toContainText(`${key}-1 was restored to its column.`);

  expect((await page.request.get(`/api/v1/tasks/${key}-1`)).status()).toBe(200);
});

test("a Viewer sees projects but no New project, no Settings, and not the settings page", async ({
  page,
  browser,
}) => {
  const manager = await browser.newPage({ baseURL: E2E_BASE_URL });
  await signInAs(manager, "manager");
  const key = uniqueKey();
  await createProjectThroughApi(manager, key, `Viewed ${key}`);
  await manager.close();
  await signInAs(page, "viewer");

  await page.goto("/projects");
  await expect(page.getByRole("link", { name: `Viewed ${key}` })).toBeVisible();
  await expect(page.getByRole("button", { name: "New project" })).toHaveCount(0);

  await page.goto(`/projects/${key}`);
  await expect(page.getByRole("heading", { level: 1, name: `Viewed ${key}` })).toBeVisible();
  // Scoped to the project tabs and exact: a page-wide substring match would also count a
  // task card whose title contains "Settings" (WI-085).
  const projectNav = page.getByRole("navigation", { name: "Project" });
  await expect(projectNav.getByRole("link", { name: "Board", exact: true })).toBeVisible();
  await expect(projectNav.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);

  // A not-found page. Its status stays 200 because the response is already streaming when
  // the settings page refuses (the project layout comes first), so Next.js marks it
  // noindex instead (WS-036, "Deviations").
  await page.goto(`/projects/${key}/settings`);
  await expect(page.getByRole("heading", { name: "This page could not be found." })).toBeVisible();
  await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Details" })).toHaveCount(0);
});

test("at phone width the projects pages have no horizontal page scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signInAs(page, "manager");
  const key = uniqueKey();
  await createProjectThroughApi(
    page,
    key,
    `A project with a rather long name ${crypto.randomUUID()}`,
  );

  for (const path of ["/projects", `/projects/${key}`, `/projects/${key}/settings`]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
