// Live board (WS-048): two browsers on one board. Each test makes its own project, so the
// parallel workers never see each other's events (WT-04 risk 6).
import { type Browser, type Locator, type Page } from "@playwright/test";

import { expect, test } from "./base";
import { E2E_BASE_URL } from "./environment";
import { seedAccount } from "./seed";

const password = "an e2e live board password, long enough";
const headers = { Origin: E2E_BASE_URL };

type Role = "manager" | "member";

async function signInAs(page: Page, role: Role): Promise<void> {
  const id = crypto.randomUUID().slice(0, 8);
  const email = `live-${role}-${id}@example.com`;
  await seedAccount({ email, password, role, name: `${role} ${id}` });
  const response = await page.request.post("/api/v1/auth/sign-in", {
    headers,
    data: { email, password },
  });
  expect(response.status()).toBe(200);
}

/** A page in a browser context of its own: another person, with another session. */
async function person(browser: Browser, role: Role): Promise<Page> {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL });
  const page = await context.newPage();
  await signInAs(page, role);
  return page;
}

async function newProject(page: Page): Promise<string> {
  const key = `L${crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
  const response = await page.request.post("/api/v1/projects", {
    headers,
    data: { key, name: `Live ${key}` },
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

function column(page: Page, name: string): Locator {
  return page.getByRole("region", { name: new RegExp(`^${name}`) });
}

async function titlesIn(page: Page, name: string): Promise<string[]> {
  return column(page, name).getByRole("listitem").locator("[data-title]").allInnerTexts();
}

/** Opens the board and waits until it is loaded with its stream open. */
async function openBoard(page: Page, key: string): Promise<void> {
  const stream = page.waitForResponse((response) => response.url().endsWith(`/events`));
  await page.goto(`/projects/${key}`);
  expect((await stream).status()).toBe(200);
  await expect(page.getByRole("region", { name: "Board" })).toBeVisible();
}

/** Drags `from` onto `to` with the mouse, in small steps, as a person would. */
async function drag(page: Page, from: Locator, to: Locator): Promise<void> {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error("not visible");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 2, { steps: 2 });
  await page.mouse.up();
}

/** A Manager and a Member on the same new project, each with its board open. */
async function twoBoards(browser: Browser, titles: string[]) {
  const a = await person(browser, "manager");
  const key = await newProject(a);
  for (const title of titles) await createTask(a, key, title);
  const b = await person(browser, "member");
  await openBoard(a, key);
  await openBoard(b, key);
  return { a, b, key };
}

test.afterEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close();
});

test("a card moved in one browser moves in the other, without a reload", async ({ browser }) => {
  const { a, b } = await twoBoards(browser, ["Alpha", "Bravo"]);
  let reloads = 0;
  b.on("framenavigated", () => {
    reloads += 1;
  });

  const moved = a.waitForResponse((response) => response.url().endsWith("/move"));
  await drag(
    a,
    column(a, "To do").getByRole("button", { name: /Alpha/ }),
    column(a, "In progress"),
  );
  expect((await moved).status()).toBe(200);

  await expect.poll(() => titlesIn(b, "In progress"), { timeout: 2_000 }).toEqual(["Alpha"]);
  expect(await titlesIn(b, "To do")).toEqual(["Bravo"]);
  expect(reloads).toBe(0);
});

test("a card reordered within its column moves on the other board, without a reload (WS-113)", async ({
  browser,
}) => {
  const { a, b, key } = await twoBoards(browser, ["India", "Juliet"]);
  let reloads = 0;
  b.on("framenavigated", () => {
    reloads += 1;
  });

  await a.getByRole("button", { name: `Actions for ${key}-2` }).click();
  const moved = a.waitForResponse((response) => response.url().endsWith("/move"));
  await a.getByRole("menuitem", { name: "Move to top" }).click();
  expect((await moved).status()).toBe(200);

  await expect.poll(() => titlesIn(b, "To do"), { timeout: 2_000 }).toEqual(["Juliet", "India"]);
  expect(reloads).toBe(0);
});

test("a task created through the API appears on an open board", async ({ browser }) => {
  const { a, b, key } = await twoBoards(browser, ["Charlie"]);

  await createTask(a, key, "Delta, from the API");

  await expect
    .poll(() => titlesIn(b, "To do"), { timeout: 2_000 })
    .toEqual(["Charlie", "Delta, from the API"]);
});

test("a deleted task disappears from the other board, and comes back when restored", async ({
  browser,
}) => {
  const { a, b, key } = await twoBoards(browser, ["Echo", "Foxtrot"]);

  await a.getByRole("link", { name: "Echo" }).click();
  await a.getByRole("dialog").getByRole("button", { name: "Delete task" }).click();
  // The 2 s start once the delete is saved, as the move test's start once its move has
  // answered (WS-128).
  const deleted = a.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" && response.url().endsWith(`/tasks/${key}-1`),
  );
  await a.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  expect((await deleted).status()).toBe(204);

  await expect.poll(() => titlesIn(b, "To do"), { timeout: 2_000 }).toEqual(["Foxtrot"]);

  await a.goto(`/projects/${key}/settings`);
  await a.getByRole("button", { name: `Restore ${key}-1` }).click();
  await expect(a.getByRole("status")).toContainText(`${key}-1 was restored to its column.`);

  await expect.poll(() => titlesIn(b, "To do"), { timeout: 2_000 }).toEqual(["Echo", "Foxtrot"]);
});

test("a task moved to the backlog through the API leaves an open board (WS-101)", async ({
  browser,
}) => {
  const { a, b, key } = await twoBoards(browser, ["Golf", "Hotel"]);

  const response = await a.request.post(`/api/v1/tasks/${key}-1/move`, {
    headers,
    data: { columnId: null, version: 1 },
  });
  expect(response.status()).toBe(200);

  await expect.poll(() => titlesIn(b, "To do"), { timeout: 2_000 }).toEqual(["Hotel"]);
  await expect.poll(() => titlesIn(a, "To do"), { timeout: 2_000 }).toEqual(["Hotel"]);
});

test("a title edited in the task detail shows on the other board", async ({ browser }) => {
  const { a, b } = await twoBoards(browser, ["Golf"]);

  await a.getByRole("link", { name: "Golf" }).click();
  const details = a.getByRole("region", { name: "Details" });
  await details.getByLabel("Title").fill("Golf, renamed");
  await details.getByRole("button", { name: "Save changes" }).click();
  await expect(a.getByRole("status", { name: "Task messages" })).toContainText("Saved.");

  await expect.poll(() => titlesIn(b, "To do"), { timeout: 2_000 }).toEqual(["Golf, renamed"]);
});

test("a column added in the project settings appears on an open board", async ({ browser }) => {
  const { a, b, key } = await twoBoards(browser, []);

  await a.goto(`/projects/${key}/settings`);
  await a.getByRole("button", { name: "Add column" }).click();
  const add = a.getByRole("dialog", { name: "Add a column" });
  await add.getByLabel("Name").fill("Review");
  await add.getByLabel("Category").selectOption({ label: "In progress" });
  await add.getByRole("button", { name: "Add column" }).click();
  await expect(
    a.getByRole("region", { name: "Columns" }).getByRole("row", { name: /Review/ }),
  ).toBeVisible();

  await expect(column(b, "Review")).toBeVisible({ timeout: 2_000 });
});

test("archiving the project makes the other board read-only and says so; unarchiving undoes it", async ({
  browser,
}) => {
  const { a, b, key } = await twoBoards(browser, ["Hotel"]);
  await expect(b.getByRole("button", { name: "Add task" }).first()).toBeVisible();

  await a.goto(`/projects/${key}/settings`);
  await a.getByRole("button", { name: "Archive project" }).click();
  await a.getByRole("alertdialog").getByRole("button", { name: "Archive" }).click();

  await expect(b.getByRole("status", { name: "Board messages" })).toHaveText(
    "This project was archived. The board is read-only.",
    { timeout: 2_000 },
  );
  await expect(b.getByText("This project is archived. The board is read-only.")).toBeVisible();
  await expect(b.getByRole("button", { name: "Add task" })).toHaveCount(0);

  await a.getByRole("button", { name: "Unarchive project" }).click();

  await expect(b.getByRole("status", { name: "Board messages" })).toHaveText(
    "This project was unarchived.",
    { timeout: 2_000 },
  );
  await expect(b.getByRole("button", { name: "Add task" }).first()).toBeVisible();
});
