import type { Browser, Page } from "@playwright/test";

import { expect, test } from "./base";
import { E2E_BASE_URL } from "./environment";
import { seedAccount } from "./seed";

const password = "an e2e task detail password, long";
const headers = { Origin: E2E_BASE_URL };

type Role = "manager" | "member" | "viewer";

/** Signs `page` in as a new account of `role`; returns its name. */
async function signInAs(page: Page, role: Role): Promise<string> {
  const id = crypto.randomUUID().slice(0, 8);
  const name = `${role} ${id}`;
  const email = `task-${role}-${id}@example.com`;
  await seedAccount({ email, password, role, name });
  const response = await page.request.post("/api/v1/auth/sign-in", {
    headers,
    data: { email, password },
  });
  expect(response.status()).toBe(200);
  return name;
}

function uniqueKey(): string {
  return `T${crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
}

/** A signed-in Manager in a page of its own, with a new project. */
async function managerWithProject(browser: Browser): Promise<{ manager: Page; key: string }> {
  const manager = await browser.newPage({ baseURL: E2E_BASE_URL });
  await signInAs(manager, "manager");
  const key = uniqueKey();
  const response = await manager.request.post("/api/v1/projects", {
    headers,
    data: { key, name: `Tasks ${key}` },
  });
  expect(response.status()).toBe(201);
  return { manager, key };
}

async function createTask(page: Page, key: string, title: string) {
  const response = await page.request.post(`/api/v1/projects/${key}/tasks`, {
    headers,
    data: { title },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; key: string; version: number };
}

function messages(page: Page) {
  return page.getByRole("status", { name: "Task messages" });
}

function details(page: Page) {
  return page.getByRole("region", { name: "Details" });
}

test("a card opens the task as a dialog over the board; Back and Forward close and reopen it", async ({
  page,
  browser,
}) => {
  const { manager, key } = await managerWithProject(browser);
  await createTask(manager, key, "Open me");
  await manager.close();
  await signInAs(page, "member");

  await page.goto(`/projects/${key}`);
  await page.getByRole("link", { name: "Open me" }).click();

  await expect(page).toHaveURL(new RegExp(`/projects/${key}/tasks/${key}-1$`));
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { level: 2, name: "Open me" })).toBeVisible();
  await expect(page.locator('[aria-label="Board"]')).toBeAttached();

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/projects/${key}$`));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Board" })).toBeVisible();

  await page.goForward();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Open me" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/projects/${key}$`));
});

test("a reload or a direct visit shows the full page; unknown and deleted tasks do not exist", async ({
  page,
  browser,
}) => {
  const { manager, key } = await managerWithProject(browser);
  await createTask(manager, key, "Full page");
  const gone = await createTask(manager, key, "Gone soon");
  expect((await manager.request.delete(`/api/v1/tasks/${gone.id}`, { headers })).status()).toBe(
    204,
  );
  await manager.close();
  await signInAs(page, "member");

  await page.goto(`/projects/${key}/tasks/${key}-1`);
  await expect(page.getByRole("heading", { level: 2, name: "Full page" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Board" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 2, name: "Full page" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  for (const missing of [`${key}-99`, `${key}-2`]) {
    await page.goto(`/projects/${key}/tasks/${missing}`);
    await expect(page.getByText("This task does not exist.")).toBeVisible();
  }
});

test("a Member edits and assigns a task, then moves it with the column select", async ({
  page,
  browser,
}) => {
  const { manager, key } = await managerWithProject(browser);
  const team = `Team ${crypto.randomUUID().slice(0, 8)}`;
  expect(
    (await manager.request.post("/api/v1/teams", { headers, data: { name: team } })).status(),
  ).toBe(201);
  expect(
    (
      await manager.request.post(`/api/v1/projects/${key}/epics`, {
        headers,
        data: { title: "Launch" },
      })
    ).status(),
  ).toBe(201);
  await createTask(manager, key, "Draft");
  await manager.close();
  const me = await signInAs(page, "member");

  await page.goto(`/projects/${key}/tasks/${key}-1`);
  const form = details(page);
  await form.getByLabel("Title").fill("Polished");
  await form.getByLabel("Type").selectOption({ label: "Bug" });
  await form.getByLabel("Description").fill("Steps:\n\n1. open\n2. **click**");
  await form.getByLabel("Team").selectOption({ label: team });
  await form.getByLabel("Find a person").fill(me);
  await form.getByRole("button", { name: `Choose ${me}` }).click();
  await form.getByLabel("Epic").selectOption({ label: "Launch" });
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(messages(page)).toContainText("Saved.");

  await page.reload();
  await expect(page.getByRole("heading", { level: 2, name: "Polished" })).toBeVisible();
  await expect(details(page).getByLabel("Type")).toHaveValue("bug");
  await expect(details(page).getByLabel("Team").locator("option:checked")).toHaveText(team);
  await expect(details(page).getByText(me).first()).toBeVisible();
  await expect(details(page).getByLabel("Epic").locator("option:checked")).toHaveText("Launch");

  // From the board, as a dialog: the column select moves it, and the board follows.
  await page.goto(`/projects/${key}`);
  await page.getByRole("link", { name: "Polished" }).click();
  await page.getByRole("dialog").getByLabel("Column").selectOption({ label: "Done" });
  await expect(
    page.getByRole("dialog").getByRole("status", { name: "Task messages" }),
  ).toContainText("Moved to Done.");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: /^Done/ }).getByRole("link", { name: "Polished" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: /^To do/ }).getByRole("link", { name: "Polished" }),
  ).toHaveCount(0);
});

test("Markdown renders safely in descriptions and comments", async ({ page, browser }) => {
  const { manager, key } = await managerWithProject(browser);
  const created = await createTask(manager, key, "Markdown");
  const hostile = [
    "Some **bold** text.",
    "",
    "<script>window.injected = true</script>",
    "",
    '<img src="/missing.png" onerror="window.injected = true">',
    "",
    "[bad link](javascript:window.injected=true) and [good link](https://example.com)",
  ].join("\n");
  expect(
    (
      await manager.request.patch(`/api/v1/tasks/${created.id}`, {
        headers,
        data: { description: hostile, version: created.version },
      })
    ).status(),
  ).toBe(200);
  await manager.close();
  await signInAs(page, "member");

  await page.goto(`/projects/${key}/tasks/${key}-1`);
  await page.getByRole("button", { name: "Preview" }).first().click();
  const comments = page.getByRole("region", { name: "Comments" });
  await comments.getByLabel("New comment").fill(`A *comment*.\n\n${hostile}`);
  await comments.getByRole("button", { name: "Add comment" }).click();
  await expect(messages(page)).toContainText("Comment added.");

  await expect(page.getByText("bold", { exact: true }).first()).toBeVisible();
  await expect(comments.getByText("comment", { exact: true })).toBeVisible();
  for (const scope of [details(page), comments]) {
    await expect(scope.locator("script")).toHaveCount(0);
    await expect(scope.locator("img")).toHaveCount(0);
    await expect(scope.getByText("bad link").first()).toBeVisible();
    await expect(scope.locator("a", { hasText: "bad link" })).toHaveCount(0);
    await expect(scope.getByRole("link", { name: "good link" }).first()).toHaveAttribute(
      "href",
      "https://example.com",
    );
  }
  expect(await page.evaluate(() => (window as { injected?: boolean }).injected)).toBeUndefined();
});

test("the reporter deletes their task from the dialog; another Member cannot; a Manager can", async ({
  page,
  browser,
}) => {
  const { manager, key } = await managerWithProject(browser);
  const other = await browser.newPage({ baseURL: E2E_BASE_URL });
  await signInAs(other, "member");
  await createTask(other, key, "Theirs");
  await signInAs(page, "member");
  await createTask(page, key, "Mine");

  await page.goto(`/projects/${key}`);
  await page.getByRole("link", { name: "Theirs" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Theirs" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete task" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: "Mine" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete task" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/projects/${key}$`));
  await expect(page.getByRole("link", { name: "Mine" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Theirs" })).toBeVisible();

  await manager.goto(`/projects/${key}/tasks/${key}-1`);
  await expect(manager.getByRole("button", { name: "Delete task" })).toBeVisible();
  await manager.close();
  await other.close();
});

test("a Viewer and an archived project are read-only; a stale save shows the conflict", async ({
  page,
  browser,
}) => {
  const { manager, key } = await managerWithProject(browser);
  const task = await createTask(manager, key, "Shared");
  const viewer = await browser.newPage({ baseURL: E2E_BASE_URL });
  await signInAs(viewer, "viewer");
  await viewer.goto(`/projects/${key}/tasks/${key}-1`);
  await expect(viewer.getByRole("heading", { level: 2, name: "Shared" })).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Save changes" })).toHaveCount(0);
  await expect(viewer.getByLabel("Column")).toHaveCount(0);
  await expect(viewer.getByLabel("New comment")).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: "Delete task" })).toHaveCount(0);
  await viewer.close();

  await signInAs(page, "member");
  await page.goto(`/projects/${key}/tasks/${key}-1`);
  await details(page).getByLabel("Title").fill("Mine");
  expect(
    (
      await manager.request.patch(`/api/v1/tasks/${task.id}`, {
        headers,
        data: { title: "Theirs", version: task.version },
      })
    ).status(),
  ).toBe(200);
  await details(page).getByRole("button", { name: "Save changes" }).click();
  await expect(messages(page)).toContainText(
    "Someone else changed this task. Their version is shown; make your change again.",
  );
  await expect(details(page).getByLabel("Title")).toHaveValue("Theirs");

  expect(
    (await manager.request.post(`/api/v1/projects/${key}/archive`, { headers })).status(),
  ).toBe(200);
  await page.reload();
  await expect(page.getByText("This project is archived. The task is read-only.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
  await expect(page.getByLabel("New comment")).toHaveCount(0);
  await manager.close();
});

test("at phone width the task page has no horizontal page scroll", async ({ page, browser }) => {
  const { manager, key } = await managerWithProject(browser);
  await createTask(manager, key, `A long title that has to wrap ${"word ".repeat(20)}`.trim());
  await manager.close();
  await page.setViewportSize({ width: 375, height: 800 });
  await signInAs(page, "member");

  await page.goto(`/projects/${key}/tasks/${key}-1`);
  await expect(page.getByRole("region", { name: "Comments" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
