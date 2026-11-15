import AxeBuilder from "@axe-core/playwright";
import {
  type APIRequestContext,
  type Browser,
  expect,
  type Page,
  test as base,
  test,
} from "@playwright/test";

import { E2E_BASE_URL } from "./environment";
import { seedAccount, seedTasks } from "./seed";

const password = "an e2e board password, long";

async function signIn(request: APIRequestContext, email: string) {
  const response = await request.post("/api/v1/auth/sign-in", {
    headers: { Origin: E2E_BASE_URL },
    data: { email, password },
  });
  expect(response.status()).toBe(200);
}

async function send(request: APIRequestContext, path: string, data?: unknown) {
  const response = await request.post(path, {
    headers: { Origin: E2E_BASE_URL },
    ...(data === undefined ? {} : { data }),
  });
  expect(response.status(), path).toBeLessThan(300);
  return (await response.json()) as { id: string };
}

/** A key no other test of the run uses: the end-to-end database keeps every project. */
function newKey(): string {
  return `B${String(Date.now()).slice(-7)}${String(Math.floor(Math.random() * 10))}`;
}

/** A project with three tasks in To do, made by a Manager in a context of its own. */
async function seedBoard(
  browser: Browser,
  extra?: (request: APIRequestContext, key: string) => Promise<void>,
) {
  const key = newKey();
  const context = await browser.newContext({ baseURL: E2E_BASE_URL });
  try {
    const email = `manager-${crypto.randomUUID()}@example.com`;
    await seedAccount({ email, password, role: "manager" });
    await signIn(context.request, email);
    await send(context.request, "/api/v1/projects", { key, name: "Board project" });
    for (const title of ["First", "Second", "Third"]) {
      await send(context.request, `/api/v1/projects/${key}/tasks`, { title });
    }
    await extra?.(context.request, key);
  } finally {
    await context.close();
  }
  return key;
}

function as(role: "member" | "viewer" | "manager") {
  return base.extend({
    page: async ({ page }, provide) => {
      const email = `${role}-${crypto.randomUUID()}@example.com`;
      await seedAccount({ email, password, role });
      await signIn(page.request, email);
      await provide(page);
    },
  });
}

const member = as("member");
const viewer = as("viewer");

function keysIn(page: Page, column: string) {
  return page.getByRole("list", { name: column }).getByRole("listitem");
}

async function dragWithMouse(page: Page, handle: string, target: ReturnType<Page["locator"]>) {
  const from = await page.getByRole("button", { name: handle }).boundingBox();
  const to = await target.boundingBox();
  if (from === null || to === null) throw new Error("nothing to drag");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 });
  await page.mouse.up();
}

member(
  "a Member adds tasks to a column and they keep their keys after a reload",
  async ({ page, browser }) => {
    const key = await seedBoard(browser);
    await page.goto(`/projects/${key}`);

    const field = page.getByRole("textbox", { name: "Add a task to In progress" });
    await field.fill("Alpha");
    await field.press("Enter");
    // Like a person, wait for the first card before typing the next: two creations in flight
    // may reach the server in either order.
    await expect(keysIn(page, "In progress")).toHaveCount(1);
    await field.fill("Beta");
    await field.press("Enter");

    await expect(keysIn(page, "In progress")).toHaveCount(2);
    await expect(keysIn(page, "In progress").nth(0)).toContainText(`${key}-4`);
    await expect(keysIn(page, "In progress").nth(1)).toContainText(`${key}-5`);
    await page.reload();
    await expect(keysIn(page, "In progress")).toHaveCount(2);
  },
);

member(
  "a Member drags a card to another column and within a column, and the order survives a reload",
  async ({ page, browser }) => {
    const key = await seedBoard(browser);
    await page.goto(`/projects/${key}`);
    await expect(keysIn(page, "To do")).toHaveCount(3);

    await dragWithMouse(page, `Drag ${key}-1`, page.getByRole("list", { name: "In progress" }));
    await expect(keysIn(page, "In progress")).toHaveCount(1);
    await expect(keysIn(page, "In progress").first()).toContainText(`${key}-1`);

    await dragWithMouse(page, `Drag ${key}-2`, keysIn(page, "To do").nth(1));
    await expect(keysIn(page, "To do").nth(0)).toContainText(`${key}-3`);
    await expect(keysIn(page, "To do").nth(1)).toContainText(`${key}-2`);

    await page.reload();
    await expect(keysIn(page, "In progress").first()).toContainText(`${key}-1`);
    await expect(keysIn(page, "To do").nth(0)).toContainText(`${key}-3`);
    await expect(keysIn(page, "To do").nth(1)).toContainText(`${key}-2`);
  },
);

member(
  "a Member moves a card with the keyboard alone, and Escape cancels",
  async ({ page, browser }) => {
    const key = await seedBoard(browser);
    await page.goto(`/projects/${key}`);
    const handle = page.getByRole("button", { name: `Drag ${key}-1` });

    // dnd-kit announces each step in a live region of its own; waiting for the words keeps the
    // key presses from outrunning the library.
    const live = page.locator("[aria-live=assertive]").first();
    await handle.focus();
    await page.keyboard.press("Space");
    await expect(live).toContainText("Picked up");
    await page.keyboard.press("ArrowRight");
    await expect(live).toContainText("is over In progress");
    await page.keyboard.press("Escape");
    await expect(live).toContainText("Move cancelled");
    await expect(keysIn(page, "To do")).toHaveCount(3);

    await handle.focus();
    await page.keyboard.press("Space");
    await expect(live).toContainText("Picked up");
    await page.keyboard.press("ArrowRight");
    await expect(live).toContainText("is over In progress");
    await page.keyboard.press("Space");
    await expect(live).toContainText("Dropped");
    await expect(keysIn(page, "To do")).toHaveCount(2);
    await expect(keysIn(page, "In progress").first()).toContainText(`${key}-1`);
    await page.reload();
    await expect(keysIn(page, "In progress").first()).toContainText(`${key}-1`);
  },
);

member(
  "a card moved from the menu, and a stale move reloads the board and says so",
  async ({ page, browser }) => {
    const key = await seedBoard(browser);
    await page.goto(`/projects/${key}`);
    await expect(keysIn(page, "To do")).toHaveCount(3);

    // Someone else moves the same card first, from a second context.
    const other = await browser.newContext({ baseURL: E2E_BASE_URL });
    try {
      const email = `manager-${crypto.randomUUID()}@example.com`;
      await seedAccount({ email, password, role: "manager" });
      await signIn(other.request, email);
      const columns = (await (
        await other.request.get(`/api/v1/projects/${key}/columns`)
      ).json()) as {
        items: { id: string; name: string }[];
      };
      const done = columns.items.find((column) => column.name === "Done");
      const task = await other.request.get(`/api/v1/tasks/${key}-1`);
      const { version } = (await task.json()) as { version: number };
      await send(other.request, `/api/v1/tasks/${key}-1/move`, { columnId: done?.id, version });
    } finally {
      await other.close();
    }

    await page.getByRole("button", { name: `Actions for ${key}-1` }).click();
    await page.getByRole("menuitem", { name: "Move to In progress" }).click();

    await expect(page.getByRole("status", { name: "Board messages" })).toContainText(
      "Someone else changed the board. It was reloaded.",
    );
    await expect(keysIn(page, "Done").first()).toContainText(`${key}-1`);
  },
);

viewer("a Viewer sees the board with no controls", async ({ page, browser }) => {
  const key = await seedBoard(browser);
  await page.goto(`/projects/${key}`);

  await expect(keysIn(page, "To do")).toHaveCount(3);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Actions for/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Drag / })).toHaveCount(0);
});

member("an archived project shows the board with no controls", async ({ page, browser }) => {
  const key = await seedBoard(browser, async (request, projectKey) => {
    await send(request, `/api/v1/projects/${projectKey}/archive`);
  });
  await page.goto(`/projects/${key}`);

  await expect(keysIn(page, "To do")).toHaveCount(3);
  await expect(
    page.getByText("This project is archived, so the board is read-only."),
  ).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Actions for/ })).toHaveCount(0);
});

viewer("a board of a thousand tasks loads, and the time is recorded", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const key = await seedBoard(browser);
  await seedTasks(key, 1000);
  const started = Date.now();

  await page.goto(`/projects/${key}`);
  await expect(page.getByText("Seeded task 1000", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  const elapsed = Date.now() - started;

  console.warn(`Board of 1 003 tasks: ${String(elapsed)} ms to show the last card.`);
  expect(await keysIn(page, "To do").count()).toBe(1003);
  expect(elapsed).toBeLessThan(15_000);
});

for (const colorScheme of ["light", "dark"] as const) {
  member(
    `the board fits a phone and has no accessibility violations in ${colorScheme} mode`,
    async ({ page, browser }) => {
      const key = await seedBoard(browser);
      await page.setViewportSize({ width: 390, height: 800 });
      await page.emulateMedia({ colorScheme });
      await page.goto(`/projects/${key}`);
      await expect(keysIn(page, "To do")).toHaveCount(3);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const region = page.getByRole("region", { name: "Board" });
      expect(await region.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations.map((violation) => violation.id)).toEqual([]);
    },
  );
}
