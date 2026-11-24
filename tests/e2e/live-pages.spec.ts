// Live task detail, epics page and project settings (WS-049): two browsers on one project.
// Each test makes its own project, so the parallel workers never see each other's events.
import { type Browser, type Page } from "@playwright/test";

import { expect, test } from "./base";
import { E2E_BASE_URL } from "./environment";
import { seedAccount } from "./seed";

const password = "an e2e live pages password, long enough";
const headers = { Origin: E2E_BASE_URL };

type Role = "manager" | "member";

async function person(browser: Browser, role: Role): Promise<Page> {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL });
  const page = await context.newPage();
  const id = crypto.randomUUID().slice(0, 8);
  const email = `pages-${role}-${id}@example.com`;
  await seedAccount({ email, password, role, name: `${role} ${id}` });
  const response = await page.request.post("/api/v1/auth/sign-in", {
    headers,
    data: { email, password },
  });
  expect(response.status()).toBe(200);
  return page;
}

async function newProject(page: Page): Promise<string> {
  const key = `P${crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
  const response = await page.request.post("/api/v1/projects", {
    headers,
    data: { key, name: `Pages ${key}` },
  });
  expect(response.status()).toBe(201);
  return key;
}

async function createTask(page: Page, key: string, title: string) {
  const response = await page.request.post(`/api/v1/projects/${key}/tasks`, {
    headers,
    data: { title },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; key: string; version: number };
}

/** Goes to `path` and waits until the page's events stream is open. */
async function openLive(page: Page, path: string): Promise<void> {
  const stream = page.waitForResponse((response) => response.url().endsWith("/events"));
  await page.goto(path);
  expect((await stream).status()).toBe(200);
}

function details(page: Page) {
  return page.getByRole("region", { name: "Details" });
}

test.afterEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close();
});

test("a comment and a title change made elsewhere appear in an open task detail", async ({
  browser,
}) => {
  const a = await person(browser, "manager");
  const key = await newProject(a);
  const created = await createTask(a, key, "India");
  const b = await person(browser, "member");
  await openLive(b, `/projects/${key}/tasks/${created.key}`);
  await expect(b.getByRole("heading", { level: 2, name: "India" })).toBeVisible();

  const comment = await a.request.post(`/api/v1/tasks/${created.key}/comments`, {
    headers,
    data: { body: "A comment from **A**" },
  });
  expect(comment.status()).toBe(201);
  await expect(b.getByRole("region", { name: "Activity" }).getByText("A comment from")).toBeVisible(
    { timeout: 2_000 },
  );

  const renamed = await a.request.patch(`/api/v1/tasks/${created.key}`, {
    headers,
    data: { title: "India, renamed", version: created.version },
  });
  expect(renamed.status()).toBe(200);
  await expect(b.getByRole("heading", { level: 2, name: "India, renamed" })).toBeVisible({
    timeout: 2_000,
  });
  await expect(b.getByRole("status", { name: "Task messages" })).toHaveText(
    "Someone else changed this task.",
  );
});

test("unsaved edits survive a change made elsewhere, and the save shows the conflict", async ({
  browser,
}) => {
  const a = await person(browser, "manager");
  const key = await newProject(a);
  const created = await createTask(a, key, "Juliett");
  const b = await person(browser, "member");
  await openLive(b, `/projects/${key}/tasks/${created.key}`);
  await details(b).getByLabel("Title").fill("Juliett, mine");

  const theirs = await a.request.patch(`/api/v1/tasks/${created.key}`, {
    headers,
    data: { description: "Their description", version: created.version },
  });
  expect(theirs.status()).toBe(200);

  await expect(details(b).getByLabel("Description")).toHaveValue("Their description", {
    timeout: 2_000,
  });
  await expect(details(b).getByLabel("Title")).toHaveValue("Juliett, mine");
  await expect(b.getByRole("status", { name: "Task messages" })).toHaveText(
    "Someone else changed this task. Saving will show their version first.",
  );

  await details(b).getByRole("button", { name: "Save changes" }).click();
  await expect(b.getByRole("status", { name: "Task messages" })).toHaveText(
    "Someone else changed this task. Their version is shown; make your change again.",
  );
  await expect(details(b).getByLabel("Title")).toHaveValue("Juliett");
});

test("an epic created and then closed elsewhere shows on an open epics page", async ({
  browser,
}) => {
  const a = await person(browser, "manager");
  const key = await newProject(a);
  const b = await person(browser, "member");
  await openLive(b, `/projects/${key}/epics?show=all`);

  const created = await a.request.post(`/api/v1/projects/${key}/epics`, {
    headers,
    data: { title: "Kilo" },
  });
  expect(created.status()).toBe(201);
  const epic = (await created.json()) as { id: string; version: number };
  const row = b.getByRole("row", { name: /Kilo/ });
  await expect(row).toContainText("Open", { timeout: 2_000 });

  const closed = await a.request.patch(`/api/v1/epics/${epic.id}`, {
    headers,
    data: { status: "closed", version: epic.version },
  });
  expect(closed.status()).toBe(200);
  await expect(row).toContainText("Closed", { timeout: 2_000 });
});

test("a column renamed in one project settings shows in another's", async ({ browser }) => {
  const a = await person(browser, "manager");
  const key = await newProject(a);
  const b = await person(browser, "manager");
  await openLive(a, `/projects/${key}/settings`);
  await openLive(b, `/projects/${key}/settings`);

  await a.getByRole("button", { name: "Edit In progress" }).click();
  const edit = a.getByRole("dialog", { name: "Edit column" });
  await edit.getByLabel("Name").fill("Doing");
  await edit.getByRole("button", { name: "Save" }).click();

  await expect(
    b.getByRole("region", { name: "Columns" }).getByRole("row", { name: /Doing/ }),
  ).toBeVisible({ timeout: 2_000 });
});

test("the board with a task dialog open uses one events stream", async ({ browser }) => {
  const a = await person(browser, "member");
  const manager = await person(browser, "manager");
  const key = await newProject(manager);
  await createTask(manager, key, "Lima");
  let streams = 0;
  a.on("request", (request) => {
    if (request.url().endsWith("/events")) streams += 1;
  });

  await openLive(a, `/projects/${key}`);
  await a.getByRole("link", { name: "Lima" }).click();
  await expect(a.getByRole("dialog").getByRole("heading", { name: "Lima" })).toBeVisible();

  expect(streams).toBe(1);
});
