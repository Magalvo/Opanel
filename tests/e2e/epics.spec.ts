import type { Browser, Page } from "@playwright/test";

import { expect, test } from "./base";
import { E2E_BASE_URL } from "./environment";
import { seedAccount } from "./seed";

const password = "an e2e epics password, long enough";
const headers = { Origin: E2E_BASE_URL };

type Role = "manager" | "member";

async function signInAs(page: Page, role: Role): Promise<void> {
  const id = crypto.randomUUID().slice(0, 8);
  const email = `epics-${role}-${id}@example.com`;
  await seedAccount({ email, password, role, name: `${role} ${id}` });
  const response = await page.request.post("/api/v1/auth/sign-in", {
    headers,
    data: { email, password },
  });
  expect(response.status()).toBe(200);
}

function uniqueKey(): string {
  return `E${crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
}

async function managerWithProject(browser: Browser): Promise<{ manager: Page; key: string }> {
  const manager = await browser.newPage({ baseURL: E2E_BASE_URL });
  await signInAs(manager, "manager");
  const key = uniqueKey();
  const response = await manager.request.post("/api/v1/projects", {
    headers,
    data: { key, name: `Epics ${key}` },
  });
  expect(response.status()).toBe(201);
  return { manager, key };
}

interface EpicJson {
  id: string;
  version: number;
}

async function createEpicThroughApi(page: Page, key: string, data: Record<string, unknown>) {
  const response = await page.request.post(`/api/v1/projects/${key}/epics`, { headers, data });
  expect(response.status()).toBe(201);
  return (await response.json()) as EpicJson;
}

function messages(page: Page) {
  return page.getByRole("status", { name: "Epic messages" });
}

test("a Manager creates, edits, follows, closes and reopens an epic", async ({ page }) => {
  await signInAs(page, "manager");
  const key = uniqueKey();
  expect(
    (await page.request.post("/api/v1/projects", { headers, data: { key, name: key } })).status(),
  ).toBe(201);

  await page.goto(`/projects/${key}`);
  await page
    .getByRole("navigation", { name: "Project" })
    .getByRole("link", { name: "Epics" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/projects/${key}/epics$`));
  await expect(page.getByText("No open epics.")).toBeVisible();

  await page.getByRole("button", { name: "New epic" }).click();
  const create = page.getByRole("dialog", { name: "New epic" });
  await create.getByLabel("Title").fill("Launch");
  await create.getByLabel("Description").fill("The **first** release.");
  await create.getByRole("button", { name: "Create epic" }).click();
  await expect(messages(page)).toContainText("Launch was created.");

  await page.getByRole("button", { name: "Launch" }).click();
  const dialog = page.getByRole("dialog", { name: "Launch" });
  await dialog.getByLabel("Target date").fill("2026-12-24");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(messages(page)).toContainText("Saved.");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("row", { name: /Launch/ })).toContainText("2026-12-24");

  // Two tasks in the epic, one of them done.
  const epics = (await (
    await page.request.get(`/api/v1/projects/${key}/epics?status=all`)
  ).json()) as { items: { id: string }[] };
  const epicId = epics.items[0]?.id ?? "";
  const columns = (await (await page.request.get(`/api/v1/projects/${key}/columns`)).json()) as {
    items: { id: string; category: string }[];
  };
  const doneColumn = columns.items.find((column) => column.category === "done")?.id ?? "";
  for (const title of ["One", "Two"]) {
    const created = await page.request.post(`/api/v1/projects/${key}/tasks`, {
      headers,
      data: { title, epicId },
    });
    expect(created.status()).toBe(201);
    if (title === "One") {
      const task = (await created.json()) as { id: string; version: number };
      const moved = await page.request.post(`/api/v1/tasks/${task.id}/move`, {
        headers,
        data: { columnId: doneColumn, version: task.version },
      });
      expect(moved.status()).toBe(200);
    }
  }
  await page.reload();
  const row = page.getByRole("row", { name: /Launch/ });
  await expect(row.getByRole("progressbar", { name: "1 of 2 tasks done" })).toBeVisible();
  await expect(row).toContainText("1 / 2");

  await page.getByRole("button", { name: "Launch" }).click();
  await page
    .getByRole("dialog", { name: "Launch" })
    .getByRole("button", { name: "Close epic" })
    .click();
  const confirm = page.getByRole("alertdialog", { name: "Close Launch?" });
  await expect(confirm).toContainText("1 of its tasks are not done yet.");
  await confirm.getByRole("button", { name: "Close epic" }).click();
  await expect(messages(page)).toContainText("Launch was closed.");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Launch" })).toHaveCount(0);

  await page.getByLabel("Show").selectOption({ label: "Closed" });
  await expect(page).toHaveURL(new RegExp(`/projects/${key}/epics\\?show=closed$`));
  await page.getByRole("button", { name: "Launch" }).click();
  await page
    .getByRole("dialog", { name: "Launch" })
    .getByRole("button", { name: "Reopen epic" })
    .click();
  await expect(messages(page)).toContainText("Launch was reopened.");
});

test("a Member reads epics with no controls; a closed epic is under Closed and All only", async ({
  page,
  browser,
}) => {
  const { manager, key } = await managerWithProject(browser);
  await createEpicThroughApi(manager, key, {
    title: "Readable",
    description: "Some **bold** words.\n\n<script>window.injected = true</script>",
  });
  const old = await createEpicThroughApi(manager, key, { title: "Old work" });
  expect(
    (
      await manager.request.patch(`/api/v1/epics/${old.id}`, {
        headers,
        data: { status: "closed", version: old.version },
      })
    ).status(),
  ).toBe(200);
  await manager.close();
  await signInAs(page, "member");

  await page.goto(`/projects/${key}`);
  await page
    .getByRole("navigation", { name: "Project" })
    .getByRole("link", { name: "Epics" })
    .click();
  await expect(page.getByRole("button", { name: "Readable" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Old work" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New epic" })).toHaveCount(0);

  await page.getByRole("button", { name: "Readable" }).click();
  const dialog = page.getByRole("dialog", { name: "Readable" });
  await expect(dialog.getByText("bold", { exact: true })).toBeVisible();
  await expect(dialog.locator("script")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Save changes" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Close epic" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => (window as { injected?: boolean }).injected)).toBeUndefined();

  await page.getByLabel("Show").selectOption({ label: "Closed" });
  await expect(page.getByRole("button", { name: "Old work" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Readable" })).toHaveCount(0);
  await page.getByLabel("Show").selectOption({ label: "All" });
  await expect(page.getByRole("button", { name: "Old work" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Readable" })).toBeVisible();
});

test("at phone width the epics page has no horizontal page scroll", async ({ page, browser }) => {
  const { manager, key } = await managerWithProject(browser);
  await createEpicThroughApi(manager, key, {
    title: `An epic with a rather long title ${"word ".repeat(12)}`.trim(),
    startDate: "2026-11-01",
    targetDate: "2026-12-01",
  });
  await manager.close();
  await page.setViewportSize({ width: 375, height: 800 });
  await signInAs(page, "member");

  await page.goto(`/projects/${key}/epics`);
  await expect(page.getByRole("table")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
