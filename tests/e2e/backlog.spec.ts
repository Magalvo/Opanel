// The Backlog page (WS-109 tests 15 and 16): a Member adds tasks to the backlog, reorders
// them by mouse and by keyboard, moves one to the board and back; a second person's open
// backlog and board follow live.
import { type Browser, type Locator, type Page } from "@playwright/test";

import { expect, test } from "./base";
import { E2E_BASE_URL } from "./environment";
import { seedAccount } from "./seed";

const password = "an e2e backlog password, long enough";
const headers = { Origin: E2E_BASE_URL };

async function person(browser: Browser, role: "manager" | "member"): Promise<Page> {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL });
  const page = await context.newPage();
  const id = crypto.randomUUID().slice(0, 8);
  const email = `backlog-${role}-${id}@example.com`;
  await seedAccount({ email, password, role, name: `${role} ${id}` });
  const response = await page.request.post("/api/v1/auth/sign-in", {
    headers,
    data: { email, password },
  });
  expect(response.status()).toBe(200);
  return page;
}

/** A Manager creates a project; returns its key. */
async function project(browser: Browser): Promise<string> {
  const manager = await person(browser, "manager");
  const key = `K${crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
  expect(
    (
      await manager.request.post("/api/v1/projects", { headers, data: { key, name: key } })
    ).status(),
  ).toBe(201);
  await manager.context().close();
  return key;
}

interface Task {
  id: string;
  key: string;
  title: string;
  version: number;
  columnId: string | null;
}

async function backlogThroughApi(page: Page, key: string): Promise<string[]> {
  const response = await page.request.get(`/api/v1/projects/${key}/backlog?limit=100`);
  return ((await response.json()) as { items: Task[] }).items.map((item) => item.title);
}

async function firstColumn(page: Page, key: string): Promise<{ id: string; name: string }> {
  const response = await page.request.get(`/api/v1/projects/${key}/columns`);
  const [first] = ((await response.json()) as { items: { id: string; name: string }[] }).items;
  if (!first) throw new Error("no column");
  return first;
}

async function taskThroughApi(page: Page, key: string): Promise<Task> {
  return (await (await page.request.get(`/api/v1/tasks/${key}`)).json()) as Task;
}

function backlog(page: Page): Locator {
  return page.getByRole("region", { name: "Backlog" });
}

async function titles(page: Page): Promise<string[]> {
  return backlog(page).getByRole("listitem").locator("[data-title]").allInnerTexts();
}

async function openBacklog(page: Page, key: string): Promise<void> {
  const stream = page.waitForResponse((response) => response.url().endsWith("/events"));
  await page.goto(`/projects/${key}/backlog`);
  expect((await stream).status()).toBe(200);
  await expect(backlog(page)).toBeVisible();
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
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 2, { steps: 2 });
  await page.mouse.up();
}

/**
 * Picks up the focused row with Space. `@dnd-kit`'s keyboard sensor starts listening for
 * arrow keys in a timer after the pick-up, so one page timer is let run first.
 */
async function pickUp(page: Page): Promise<void> {
  await page.keyboard.press("Space");
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

function moved(page: Page) {
  return page.waitForResponse(
    (response) => response.url().endsWith("/move") && response.request().method() === "POST",
  );
}

test("a Member fills and ranks the backlog, moves a task to the board and back", async ({
  browser,
}) => {
  const key = await project(browser);
  const page = await person(browser, "member");
  await openBacklog(page, key);
  await expect(backlog(page)).toContainText("The backlog is empty.");

  // Three tasks added from the page go to the end of the backlog.
  for (const title of ["Alpha", "Bravo", "Charlie"]) {
    await backlog(page).getByRole("button", { name: "Add task" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a task to the backlog" });
    await dialog.getByLabel("Title").fill(title);
    await dialog.getByRole("button", { name: "Add task" }).click();
    await expect(dialog).toBeHidden();
  }
  await expect(page.getByRole("status", { name: "Backlog messages" })).toHaveText(
    `${key}-3 was added to the backlog.`,
  );
  await expect.poll(() => titles(page)).toEqual(["Alpha", "Bravo", "Charlie"]);
  expect(await backlogThroughApi(page, key)).toEqual(["Alpha", "Bravo", "Charlie"]);

  // Charlie dragged to the top with the mouse.
  const dropped = moved(page);
  await drag(
    page,
    backlog(page).getByRole("listitem").filter({ hasText: "Charlie" }),
    backlog(page).getByRole("listitem").filter({ hasText: "Alpha" }),
  );
  expect((await dropped).status()).toBe(200);
  await expect.poll(() => titles(page)).toEqual(["Charlie", "Alpha", "Bravo"]);

  // Bravo moved up two places by keyboard, across both rows above it.
  const bravo = page.getByRole("button", { name: `Move ${key}-2 Bravo` });
  await bravo.focus();
  await pickUp(page);
  await expect(page.locator('[id^="DndLiveRegion"]')).toContainText(`Picked up ${key}-2.`);
  await page.keyboard.press("ArrowUp");
  await expect(page.locator('[id^="DndLiveRegion"]')).toContainText(
    `${key}-2 is in position 2 of 3.`,
  );
  await page.keyboard.press("ArrowUp");
  await expect(page.locator('[id^="DndLiveRegion"]')).toContainText(
    `${key}-2 is in position 1 of 3.`,
  );
  const keyed = moved(page);
  await page.keyboard.press("Space");
  expect((await keyed).status()).toBe(200);
  await expect(page.locator('[id^="DndLiveRegion"]')).toContainText(
    `${key}-2 was moved to position 1 of 3.`,
  );
  await expect(bravo).toBeFocused();

  // The order survives a reload.
  await page.reload();
  await expect.poll(() => titles(page)).toEqual(["Bravo", "Charlie", "Alpha"]);
  expect(await backlogThroughApi(page, key)).toEqual(["Bravo", "Charlie", "Alpha"]);

  // Charlie goes to the end of the first column; the keyboard moves on to Alpha's button.
  const first = await firstColumn(page, key);
  await page.getByRole("button", { name: `Move to board ${key}-3` }).click();
  await expect(page.getByRole("status", { name: "Backlog messages" })).toHaveText(
    `${key}-3 was moved to ${first.name}.`,
  );
  await expect.poll(() => titles(page)).toEqual(["Bravo", "Alpha"]);
  await expect(page.getByRole("button", { name: `Move to board ${key}-1` })).toBeFocused();
  expect((await taskThroughApi(page, `${key}-3`)).columnId).toBe(first.id);

  // And back, from the task detail's column select: to the end of the backlog.
  await page.goto(`/projects/${key}/tasks/${key}-3`);
  await page.getByLabel("Column").selectOption("Backlog");
  await expect(page.getByRole("status", { name: "Task messages" })).toHaveText(
    "Moved to the backlog.",
  );
  expect(await backlogThroughApi(page, key)).toEqual(["Bravo", "Alpha", "Charlie"]);
});

test("a second person's open backlog and board follow, with no reload", async ({ browser }) => {
  const key = await project(browser);
  const actor = await person(browser, "member");
  const watcher = await person(browser, "member");
  const board = await watcher.context().newPage();
  await openBacklog(watcher, key);
  const stream = board.waitForResponse((response) => response.url().endsWith("/events"));
  await board.goto(`/projects/${key}`);
  expect((await stream).status()).toBe(200);
  await expect(board.getByRole("region", { name: "Board" })).toBeVisible();
  for (const page of [watcher, board]) {
    await page.evaluate(() => {
      (window as unknown as { notReloaded: boolean }).notReloaded = true;
    });
  }

  async function create(title: string): Promise<Task> {
    const response = await actor.request.post(`/api/v1/projects/${key}/tasks`, {
      headers,
      data: { title, columnId: null },
    });
    expect(response.status()).toBe(201);
    return (await response.json()) as Task;
  }

  async function move(task: Task, body: Record<string, unknown>): Promise<Task> {
    const current = await taskThroughApi(actor, task.key);
    const response = await actor.request.post(`/api/v1/tasks/${task.id}/move`, {
      headers,
      data: { ...body, version: current.version },
    });
    expect(response.status()).toBe(200);
    return (await response.json()) as Task;
  }

  // Created in the backlog.
  const delta = await create("Delta");
  const echo = await create("Echo");
  await expect.poll(() => titles(watcher)).toEqual(["Delta", "Echo"]);

  // Reordered.
  await move(echo, { columnId: null, beforeTaskId: delta.id });
  await expect.poll(() => titles(watcher)).toEqual(["Echo", "Delta"]);

  // To the board: it leaves the backlog and shows on the board.
  const first = await firstColumn(actor, key);
  await move(delta, { columnId: first.id });
  await expect.poll(() => titles(watcher)).toEqual(["Echo"]);
  await expect(
    board.getByRole("region", { name: new RegExp(`^${first.name}`) }).getByText("Delta"),
  ).toBeVisible();

  // And back: it leaves the board and comes back at the end of the backlog.
  await move(delta, { columnId: null });
  await expect.poll(() => titles(watcher)).toEqual(["Echo", "Delta"]);
  await expect(board.getByRole("region", { name: "Board" }).getByText("Delta")).toBeHidden();

  for (const page of [watcher, board]) {
    expect(
      await page.evaluate(() => (window as unknown as { notReloaded?: boolean }).notReloaded),
    ).toBe(true);
  }
});
