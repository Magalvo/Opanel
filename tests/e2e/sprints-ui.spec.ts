// Sprints in the UI (WS-144 tests 14 and 15): a Manager turns sprints on and plans a sprint,
// a Member fills it by keyboard and by menu while the Manager's backlog follows live, the
// Manager completes the first sprint into the second and starts it; and the axe checks of
// the new states.
import AxeBuilder from "@axe-core/playwright";
import { type Browser, type Locator, type Page } from "@playwright/test";

import { expect, test } from "./base";
import { E2E_BASE_URL } from "./environment";
import { seedAccount } from "./seed";

const password = "an e2e sprints ui password, long enough";
const headers = { Origin: E2E_BASE_URL };
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function person(browser: Browser, role: "manager" | "member"): Promise<Page> {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL });
  const page = await context.newPage();
  const id = crypto.randomUUID().slice(0, 8);
  const email = `sprints-ui-${role}-${id}@example.com`;
  await seedAccount({ email, password, role, name: `${role} ${id}` });
  const response = await page.request.post("/api/v1/auth/sign-in", {
    headers,
    data: { email, password },
  });
  expect(response.status()).toBe(200);
  return page;
}

interface Created {
  id: string;
  key: string;
  version: number;
}

async function created(page: Page, path: string, data: Record<string, unknown>) {
  const response = await page.request.post(path, { headers, data });
  expect(response.status(), path).toBe(201);
  return (await response.json()) as Created;
}

/**
 * A Manager's project with two tasks on the board and three unscheduled in the backlog,
 * still without sprints.
 */
async function project(manager: Page): Promise<string> {
  const key = `U${crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
  await created(manager, "/api/v1/projects", { key, name: key });
  const columns = await manager.request.get(`/api/v1/projects/${key}/columns`);
  const [first] = ((await columns.json()) as { items: { id: string }[] }).items;
  if (!first) throw new Error("no column");
  for (const title of ["Board one", "Board two"]) {
    await created(manager, `/api/v1/projects/${key}/tasks`, { title, columnId: first.id });
  }
  for (const title of ["Alpha", "Bravo", "Charlie"]) {
    await created(manager, `/api/v1/projects/${key}/tasks`, { title, columnId: null });
  }
  return key;
}

async function openPage(page: Page, path: string): Promise<void> {
  const stream = page.waitForResponse((response) => response.url().endsWith("/events"));
  await page.goto(path);
  expect((await stream).status()).toBe(200);
}

function region(page: Page, name: string): Locator {
  return page.getByRole("region", { name, exact: true });
}

async function pickUp(page: Page): Promise<void> {
  await page.keyboard.press("Space");
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

function moved(page: Page) {
  return page.waitForResponse(
    (response) => response.url().endsWith("/move") && response.request().method() === "POST",
  );
}

async function violations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations.map((violation) => violation.id);
}

test("a team plans, fills, completes and starts sprints from the web app, live", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const manager = await person(browser, "manager");
  const member = await person(browser, "member");
  const key = await project(manager);

  // The Manager turns sprints on: the board's tasks become Sprint 1.
  await manager.goto(`/projects/${key}/settings`);
  await region(manager, "Sprints").getByRole("switch", { name: "Use sprints" }).click();
  const turnOn = manager.getByRole("alertdialog", { name: "Use sprints?" });
  await expect(turnOn).toContainText("Tasks on the board become 'Sprint 1'");
  await turnOn.getByRole("button", { name: "Use sprints" }).click();
  await expect(manager.getByRole("status").first()).toContainText("Sprints are on.");

  // The Manager plans Sprint 2 in the backlog.
  await openPage(manager, `/projects/${key}/backlog`);
  await expect(region(manager, "Active sprint: Sprint 1")).toContainText("0 of 2 tasks done");
  await manager.getByRole("button", { name: "Create sprint" }).click();
  const create = manager.getByRole("dialog", { name: "Create a sprint" });
  await expect(create.getByLabel("Name")).toHaveValue("Sprint 2");
  await create.getByLabel("Goal").fill("Ship the backlog");
  await create.getByRole("button", { name: "Create sprint" }).click();
  await expect(region(manager, "Sprint 2")).toContainText("No tasks yet.");

  // The Member drags Alpha into Sprint 2 by keyboard, and moves Charlie there by menu.
  await openPage(member, `/projects/${key}/backlog`);
  await expect(region(member, "Sprint 2")).toBeVisible();
  const alpha = member.getByRole("button", { name: `Move ${key}-3 Alpha` });
  await alpha.focus();
  await pickUp(member);
  await member.keyboard.press("ArrowUp");
  await expect(member.locator('[id^="DndLiveRegion"]')).toContainText(
    `${key}-3 is in Sprint 2, position 1 of 1.`,
  );
  const keyed = moved(member);
  await member.keyboard.press("Space");
  expect((await keyed).status()).toBe(200);
  await expect(region(member, "Sprint 2").getByText("Alpha")).toBeVisible();

  const byMenu = moved(member);
  await member.getByRole("button", { name: `Actions for ${key}-5` }).click();
  await member.getByRole("menuitem", { name: "Sprint 2" }).click();
  expect((await byMenu).status()).toBe(200);
  await expect(member.getByRole("status", { name: "Backlog messages" })).toContainText(
    `${key}-5 was moved to Sprint 2, position 2 of 2.`,
  );

  // The Manager's open backlog follows with no reload.
  await expect(region(manager, "Sprint 2").getByText("Alpha")).toBeVisible();
  await expect(region(manager, "Sprint 2").getByText("Charlie")).toBeVisible();
  await expect(region(manager, "Backlog").getByText("Bravo")).toBeVisible();

  // The Manager completes Sprint 1 into Sprint 2 from the board.
  await openPage(manager, `/projects/${key}`);
  const header = region(manager, "Active sprint: Sprint 1");
  await header.getByRole("button", { name: "Complete sprint" }).click();
  const complete = manager.getByRole("dialog", { name: "Complete Sprint 1?" });
  await expect(complete).toContainText("2 unfinished tasks leave the board.");
  await expect(complete.getByLabel("Move the unfinished work to")).toHaveValue(/.+/);
  await complete.getByRole("button", { name: "Complete sprint" }).click();
  await expect(manager.getByRole("status", { name: "Board messages" })).toContainText(
    "Sprint 1 completed: 0 done, 2 moved to Sprint 2.",
  );
  await expect(manager.getByText("No sprint is active.")).toBeVisible();

  // The Member's backlog follows: Sprint 2 now holds four tasks.
  await expect(region(member, "Sprint 2").getByRole("listitem")).toHaveCount(4);

  // The Manager starts Sprint 2 from the backlog; the board shows it.
  await manager.getByRole("link", { name: "Plan and start a sprint in the backlog" }).click();
  await region(manager, "Sprint 2")
    .getByRole("button", { name: /^Start sprint/ })
    .click();
  const start = manager.getByRole("alertdialog", { name: "Start Sprint 2?" });
  await expect(start).toContainText("Its 4 tasks go to the first column, To do.");
  await start.getByRole("button", { name: "Start sprint" }).click();
  await expect(manager.getByRole("status", { name: "Backlog messages" })).toContainText(
    "Sprint 2 started.",
  );
  await manager.getByRole("link", { name: "Go to the board" }).click();
  await expect(region(manager, "Active sprint: Sprint 2")).toContainText("0 of 4 tasks done");
  await expect(manager.getByRole("region", { name: /^To do/ }).getByText("Alpha")).toBeVisible();

  // The Member's backlog follows the start.
  await expect(region(member, "Active sprint: Sprint 2")).toBeVisible();
  await expect(region(member, "Backlog").getByText("Bravo")).toBeVisible();

  await manager.context().close();
  await member.context().close();
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`a backlog with sprints, a board with its sprint and a board with none have no accessibility violations in ${colorScheme} mode (WS-144)`, async ({
    browser,
  }) => {
    const manager = await person(browser, "manager");
    await manager.emulateMedia({ colorScheme });
    const key = await project(manager);
    const current = (await (await manager.request.get(`/api/v1/projects/${key}`)).json()) as {
      version: number;
    };
    const enabled = await manager.request.patch(`/api/v1/projects/${key}`, {
      headers,
      data: { sprintsEnabled: true, version: current.version },
    });
    expect(enabled.status()).toBe(200);
    await created(manager, `/api/v1/projects/${key}/sprints`, {
      name: "Sprint 2",
      goal: "Ship the backlog",
      startDate: "2026-12-15",
      endDate: "2026-12-28",
    });

    await openPage(manager, `/projects/${key}/backlog`);
    await expect(region(manager, "Sprint 2")).toBeVisible();
    await region(manager, "Completed sprints")
      .getByRole("button", { name: "Completed sprints" })
      .click();
    expect(await violations(manager), "backlog with sprints").toEqual([]);

    await openPage(manager, `/projects/${key}`);
    await expect(region(manager, "Active sprint: Sprint 1")).toBeVisible();
    expect(await violations(manager), "board with a sprint").toEqual([]);

    await region(manager, "Active sprint: Sprint 1")
      .getByRole("button", { name: "Complete sprint" })
      .click();
    await expect(manager.getByRole("dialog", { name: "Complete Sprint 1?" })).toBeVisible();
    expect(await violations(manager), "complete dialog").toEqual([]);
    await manager
      .getByRole("dialog", { name: "Complete Sprint 1?" })
      .getByRole("button", { name: "Complete sprint" })
      .click();
    await expect(manager.getByText("No sprint is active.")).toBeVisible();
    expect(await violations(manager), "board with no active sprint").toEqual([]);

    await manager.context().close();
  });
}
