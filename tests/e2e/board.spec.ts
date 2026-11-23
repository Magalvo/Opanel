import { type Locator, type Page } from "@playwright/test";

import { expect, test } from "./base";
import { E2E_BASE_URL } from "./environment";
import { seedAccount, seedTasks } from "./seed";

const password = "an e2e board password, long enough";
const headers = { Origin: E2E_BASE_URL };

type Role = "manager" | "member" | "viewer";

/** Signs `page` in as a new account of `role`; returns its email. */
async function signInAs(page: Page, role: Role): Promise<string> {
  const id = crypto.randomUUID().slice(0, 8);
  const email = `board-${role}-${id}@example.com`;
  await seedAccount({ email, password, role, name: `${role} ${id}` });
  const response = await page.request.post("/api/v1/auth/sign-in", {
    headers,
    data: { email, password },
  });
  expect(response.status()).toBe(200);
  return email;
}

function uniqueKey(): string {
  return `B${crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
}

/** A Manager, in a page of its own, creates a project; returns its key. */
async function projectByManager(page: Page): Promise<string> {
  const manager = await page.context().browser()?.newPage({ baseURL: E2E_BASE_URL });
  if (!manager) throw new Error("no browser");
  await signInAs(manager, "manager");
  const key = uniqueKey();
  const response = await manager.request.post("/api/v1/projects", {
    headers,
    data: { key, name: `Board ${key}` },
  });
  expect(response.status()).toBe(201);
  await manager.close();
  return key;
}

interface Column {
  id: string;
  name: string;
}

async function columnsOf(page: Page, key: string): Promise<Column[]> {
  const response = await page.request.get(`/api/v1/projects/${key}/columns`);
  return ((await response.json()) as { items: Column[] }).items;
}

async function createTask(page: Page, key: string, title: string, columnId?: string) {
  const response = await page.request.post(`/api/v1/projects/${key}/tasks`, {
    headers,
    data: { title, ...(columnId === undefined ? {} : { columnId }) },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; key: string; version: number };
}

/** Task titles per column name, in board order, as the API returns them. */
async function boardThroughApi(page: Page, key: string): Promise<Record<string, string[]>> {
  const columns = await columnsOf(page, key);
  const response = await page.request.get(`/api/v1/projects/${key}/tasks?limit=100`);
  const tasks = ((await response.json()) as { items: { title: string; columnId: string }[] }).items;
  return Object.fromEntries(
    columns.map((column) => [
      column.name,
      tasks.filter((item) => item.columnId === column.id).map((item) => item.title),
    ]),
  );
}

function column(page: Page, name: string): Locator {
  return page.getByRole("region", { name: new RegExp(`^${name}`) });
}

async function titlesIn(page: Page, name: string): Promise<string[]> {
  return column(page, name).getByRole("listitem").locator("[data-title]").allInnerTexts();
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

/**
 * Picks up the focused card with Space. `@dnd-kit`'s keyboard sensor starts listening for
 * arrow keys in a timer after the pick-up, so one page timer is let run first.
 */
async function pickUp(page: Page): Promise<void> {
  await page.keyboard.press("Space");
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

declare global {
  interface Window {
    announced?: string[];
  }
}

/** From now on, every text `@dnd-kit`'s live region shows is kept in `window.announced`. */
async function recordAnnouncements(page: Page): Promise<void> {
  await page.evaluate(() => {
    const region = document.querySelector('[id^="DndLiveRegion"]');
    if (!region) throw new Error("no live region");
    const announced: string[] = [];
    window.announced = announced;
    new MutationObserver(() => {
      const text = region.textContent;
      if (text !== "" && text !== announced.at(-1)) announced.push(text);
    }).observe(region, { childList: true, characterData: true, subtree: true });
  });
}

async function announcements(page: Page): Promise<string[]> {
  return page.evaluate(() => window.announced ?? []);
}

/** Lets the board re-measure and re-render: two animation frames, then 200 ms. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => setTimeout(resolve, 200));
        });
      }),
  );
}

function moved(page: Page) {
  return page.waitForResponse(
    (response) => response.url().endsWith("/move") && response.request().method() === "POST",
  );
}

test("a Member creates tasks and moves them with the mouse; the order survives a reload", async ({
  page,
}) => {
  const key = await projectByManager(page);
  await signInAs(page, "member");
  await page.goto(`/projects/${key}`);

  // Escape closes the dialog and gives the keyboard back to the button that opened it.
  const addToDone = column(page, "Done").getByRole("button", { name: "Add task" });
  await addToDone.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(addToDone).toBeFocused();

  for (const [name, title] of [
    ["To do", "Alpha"],
    ["To do", "Bravo"],
    ["To do", "Charlie"],
    ["In progress", "Delta"],
  ] as const) {
    await column(page, name).getByRole("button", { name: "Add task" }).click();
    const dialog = page.getByRole("dialog", { name: `Add a task to ${name}` });
    await dialog.getByLabel("Title").fill(title);
    await dialog.getByRole("button", { name: "Add task" }).click();
    await expect(column(page, name).getByText(title)).toBeVisible();
  }
  await expect(page.getByRole("status", { name: "Board messages" })).toContainText(
    `${key}-4 was added to In progress.`,
  );

  // Across columns: Alpha onto Delta takes Delta's place.
  let response = moved(page);
  await drag(
    page,
    column(page, "To do").getByRole("button", { name: /Alpha/ }),
    column(page, "In progress").getByRole("button", { name: /Delta/ }),
  );
  expect((await response).status()).toBe(200);
  await expect.poll(() => titlesIn(page, "In progress")).toEqual(["Alpha", "Delta"]);

  // Within a column: Charlie onto Bravo.
  response = moved(page);
  await drag(
    page,
    column(page, "To do").getByRole("button", { name: /Charlie/ }),
    column(page, "To do").getByRole("button", { name: /Bravo/ }),
  );
  expect((await response).status()).toBe(200);
  await expect.poll(() => titlesIn(page, "To do")).toEqual(["Charlie", "Bravo"]);

  await page.reload();
  await expect.poll(() => titlesIn(page, "To do")).toEqual(["Charlie", "Bravo"]);
  expect(await titlesIn(page, "In progress")).toEqual(["Alpha", "Delta"]);
  expect(await boardThroughApi(page, key)).toEqual({
    "To do": ["Charlie", "Bravo"],
    "In progress": ["Alpha", "Delta"],
    Done: [],
  });
});

test("a Member moves a card by keyboard only, and the drop is announced", async ({ page }) => {
  const key = await projectByManager(page);
  await signInAs(page, "member");
  await createTask(page, key, "Echo");
  await createTask(page, key, "Foxtrot");
  await page.goto(`/projects/${key}`);

  const echo = column(page, "To do").getByRole("button", { name: /Echo/ });
  await echo.focus();
  await pickUp(page);
  await expect(page.locator('[id^="DndLiveRegion"]')).toContainText(`Picked up ${key}-1.`);
  await page.keyboard.press("ArrowRight");
  const response = moved(page);
  await page.keyboard.press("Space");
  expect((await response).status()).toBe(200);
  await expect(page.locator('[id^="DndLiveRegion"]')).toContainText(
    `${key}-1 was moved to In progress, position 1 of 1.`,
  );
  // The keyboard stays on the card that moved, which can be picked up again once saved.
  const echoMoved = column(page, "In progress").getByRole("button", { name: /Echo/ });
  await expect(echoMoved).toBeFocused();
  await expect(echoMoved).toHaveAttribute("aria-disabled", "false");

  // Back to To do: the card lands on top of Foxtrot, and the place announced does not
  // change by itself once the board has settled (WS-054).
  await pickUp(page);
  await expect(page.locator('[id^="DndLiveRegion"]')).toContainText(`Picked up ${key}-1.`);
  await recordAnnouncements(page);
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator('[id^="DndLiveRegion"]')).toContainText("is in To do");
  await settle(page);
  expect(await announcements(page)).toEqual([`${key}-1 is in To do, position 1 of 2.`]);

  // One more arrow key puts it below Foxtrot.
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('[id^="DndLiveRegion"]')).toContainText(
    `${key}-1 is in To do, position 2 of 2.`,
  );
  const again = moved(page);
  await page.keyboard.press("Space");
  expect((await again).status()).toBe(200);
  await expect(page.locator('[id^="DndLiveRegion"]')).toContainText(
    `${key}-1 was moved to To do, position 2 of 2.`,
  );

  await page.reload();
  await expect.poll(() => titlesIn(page, "To do")).toEqual(["Foxtrot", "Echo"]);
  expect((await boardThroughApi(page, key))["To do"]).toEqual(["Foxtrot", "Echo"]);
});

test("a Member reorders and moves cards with clicks only, through each card's menu (WS-111)", async ({
  page,
}) => {
  const key = await projectByManager(page);
  await signInAs(page, "member");
  await createTask(page, key, "Alpha");
  await createTask(page, key, "Bravo");
  await createTask(page, key, "Charlie");
  await page.goto(`/projects/${key}`);
  const message = page.getByRole("status", { name: "Board messages" });

  // To the top of its column.
  await page.getByRole("button", { name: `Actions for ${key}-3` }).click();
  let response = moved(page);
  await page.getByRole("menuitem", { name: "Move to top" }).click();
  expect((await response).status()).toBe(200);
  await expect(message).toHaveText(`${key}-3 was moved to To do, position 1 of 3.`);
  await expect.poll(() => titlesIn(page, "To do")).toEqual(["Charlie", "Alpha", "Bravo"]);

  // One place down.
  await page.getByRole("button", { name: `Actions for ${key}-3` }).click();
  response = moved(page);
  await page.getByRole("menuitem", { name: "Move down" }).click();
  expect((await response).status()).toBe(200);
  await expect(message).toHaveText(`${key}-3 was moved to To do, position 2 of 3.`);

  // To another column, where it goes last.
  await page.getByRole("button", { name: `Actions for ${key}-1` }).click();
  response = moved(page);
  await page.getByRole("menuitem", { name: "In progress" }).click();
  expect((await response).status()).toBe(200);
  await expect(message).toHaveText(`${key}-1 was moved to In progress, position 1 of 1.`);
  await expect(
    column(page, "In progress").getByRole("button", { name: `Actions for ${key}-1` }),
  ).toBeFocused();

  await page.reload();
  await expect.poll(() => titlesIn(page, "To do")).toEqual(["Charlie", "Bravo"]);
  expect(await boardThroughApi(page, key)).toMatchObject({
    "To do": ["Charlie", "Bravo"],
    "In progress": ["Alpha"],
  });
});

/** The page's animations and transitions still running two frames from now. */
async function runningAnimations(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve(
              document
                .getAnimations()
                .filter((animation) => animation.playState === "running")
                .map((animation) => animation.constructor.name),
            );
          });
        });
      }),
  );
}

/**
 * In a new project of Echo and Foxtrot, moves Echo below Foxtrot by keyboard, and returns
 * the animations running while it is dragged past Foxtrot and just after the drop.
 */
async function keyboardMoveAnimations(
  page: Page,
): Promise<{ whileDragging: string[]; afterDrop: string[] }> {
  const key = await projectByManager(page);
  await createTask(page, key, "Echo");
  await createTask(page, key, "Foxtrot");
  await page.goto(`/projects/${key}`);
  const live = page.locator('[id^="DndLiveRegion"]');

  await column(page, "To do")
    .getByRole("button", { name: /^Move .* Echo$/ })
    .focus();
  await pickUp(page);
  await expect(live).toContainText(`Picked up ${key}-1.`);
  await page.keyboard.press("ArrowDown");
  await expect(live).toContainText(`${key}-1 is in To do, position 2 of 2.`);
  // Foxtrot slides up to make room, unless motion is reduced.
  const whileDragging = await runningAnimations(page);
  const response = moved(page);
  await page.keyboard.press("Space");
  // The dropped card animates to its place, unless motion is reduced.
  const afterDrop = await runningAnimations(page);
  expect((await response).status()).toBe(200);
  await expect.poll(() => titlesIn(page, "To do")).toEqual(["Foxtrot", "Echo"]);
  return { whileDragging, afterDrop };
}

test("a keyboard move runs no animation when the person asks for reduced motion (WS-111)", async ({
  page,
}) => {
  await signInAs(page, "member");

  // Without the setting the board animates, so the measurement can see an animation.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const animated = await keyboardMoveAnimations(page);
  expect([...animated.whileDragging, ...animated.afterDrop]).not.toEqual([]);

  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await keyboardMoveAnimations(page)).toEqual({ whileDragging: [], afterDrop: [] });
});

test("a card someone else moved is refreshed, with an explanation", async ({ page }) => {
  const key = await projectByManager(page);
  await signInAs(page, "member");
  const golf = await createTask(page, key, "Golf");
  await createTask(page, key, "Hotel");
  // A board that missed the other move: without its events stream it is not live (WS-048),
  // as after a lost event, and its move is then refused with a version conflict.
  await page.route("**/api/v1/projects/*/events", (route) => route.abort());
  await page.goto(`/projects/${key}`);
  // With no stream, the board loads after its 3-second fallback (WS-048 section 3), so the
  // first card can take longer than the default 5 seconds on a busy test server.
  await expect(column(page, "To do").getByText("Hotel")).toBeVisible({ timeout: 15_000 });

  const [, doing] = await columnsOf(page, key);
  if (!doing) throw new Error("no second column");
  const elsewhere = await page.request.post(`/api/v1/tasks/${golf.id}/move`, {
    headers,
    data: { columnId: doing.id, version: golf.version },
  });
  expect(elsewhere.status()).toBe(200);

  const response = moved(page);
  await drag(
    page,
    column(page, "To do").getByRole("button", { name: /Golf/ }),
    column(page, "To do").getByRole("button", { name: /Hotel/ }),
  );
  expect((await response).status()).toBe(409);
  await expect(page.getByRole("status", { name: "Board messages" })).toContainText(
    `Someone else changed ${key}-1. The board was refreshed.`,
  );
  await expect.poll(() => titlesIn(page, "In progress")).toEqual(["Golf"]);
  expect(await titlesIn(page, "To do")).toEqual(["Hotel"]);
});

test("a Viewer cannot add or move; an archived project is read-only for a Manager", async ({
  page,
  browser,
}) => {
  const key = await projectByManager(page);
  const manager = await browser.newPage({ baseURL: E2E_BASE_URL });
  await signInAs(manager, "manager");
  await createTask(manager, key, "India");
  await createTask(manager, key, "Juliett");

  await signInAs(page, "viewer");
  await page.goto(`/projects/${key}`);
  await expect(column(page, "To do").getByText("Juliett")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add task" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /India/ })).toHaveCount(0);
  let requests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/move")) requests += 1;
  });
  await drag(
    page,
    column(page, "To do").getByRole("listitem").filter({ hasText: "India" }),
    column(page, "In progress"),
  );
  expect(requests).toBe(0);
  expect(await titlesIn(page, "To do")).toEqual(["India", "Juliett"]);

  expect(
    (await manager.request.post(`/api/v1/projects/${key}/archive`, { headers })).status(),
  ).toBe(200);
  await manager.goto(`/projects/${key}`);
  await expect(
    manager.getByText("This project is archived. The board is read-only."),
  ).toBeVisible();
  await expect(manager.getByRole("button", { name: "Add task" })).toHaveCount(0);
  await expect(manager.getByRole("button", { name: /India/ })).toHaveCount(0);
  await manager.close();
});

test("a board of 1 000 tasks loads, and a card can still be moved", async ({ page }) => {
  test.setTimeout(120_000);
  const key = await projectByManager(page);
  const email = await signInAs(page, "member");
  const last = await seedTasks({ projectKey: key, count: 1000, reporterEmail: email });
  expect(last).toHaveLength(3);

  const started = Date.now();
  await page.goto(`/projects/${key}`);
  for (const lastKey of last) {
    await expect(
      page.getByRole("button", { name: new RegExp(`^Move ${lastKey}(?![0-9])`) }),
    ).toBeVisible({
      timeout: 60_000,
    });
  }
  const elapsed = Date.now() - started;
  test.info().annotations.push({ type: "board-load-ms", description: String(elapsed) });
  process.stdout.write(`WS-037: a board of 1 000 tasks appeared in ${String(elapsed)} ms\n`);
  await expect(column(page, "To do")).toContainText("334 tasks");

  const card = page.getByRole("button", { name: new RegExp(`^Move ${last[0] ?? ""}(?![0-9])`) });
  await card.focus();
  await pickUp(page);
  await page.keyboard.press("ArrowRight");
  const response = moved(page);
  await page.keyboard.press("Space");
  expect((await response).status()).toBe(200);
});

test("at phone width the board scrolls inside its region, not the page", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const key = await projectByManager(page);
  await signInAs(page, "member");
  await createTask(page, key, "A task with a rather long title that has to wrap somewhere");
  await page.goto(`/projects/${key}`);
  await expect(column(page, "Done")).toBeAttached();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const board = page.getByRole("region", { name: "Board" });
  expect(await board.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
});
