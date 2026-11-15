import AxeBuilder from "@axe-core/playwright";
import { type APIRequestContext, type Browser, type Page } from "@playwright/test";

import { expect, test as base } from "./base";
import { E2E_BASE_URL } from "./environment";
import { seedAccount } from "./seed";

const password = "an e2e task detail password, long";

async function signIn(request: APIRequestContext, email: string) {
  const response = await request.post("/api/v1/auth/sign-in", {
    headers: { Origin: E2E_BASE_URL },
    data: { email, password },
  });
  expect(response.status()).toBe(200);
}

async function send(
  request: APIRequestContext,
  method: "post" | "patch",
  path: string,
  data?: unknown,
) {
  const response = await request[method](path, {
    headers: { Origin: E2E_BASE_URL },
    ...(data === undefined ? {} : { data }),
  });
  expect(response.status(), path).toBeLessThan(300);
  return (await response.json()) as { id: string; version: number };
}

/** A key no other test of the run uses: the end-to-end database keeps every project. */
function newKey(): string {
  return `D${String(Date.now()).slice(-7)}${String(Math.floor(Math.random() * 10))}`;
}

async function signedInContext(browser: Browser, role: "manager" | "member" | "viewer") {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL });
  const email = `${role}-${crypto.randomUUID()}@example.com`;
  await seedAccount({ email, password, role });
  await signIn(context.request, email);
  return context;
}

/** A project with two tasks (made by a Manager), a team and an epic. */
async function seedProject(browser: Browser, archive = false) {
  const key = newKey();
  const context = await signedInContext(browser, "manager");
  try {
    await send(context.request, "post", "/api/v1/projects", { key, name: "Detail project" });
    for (const title of ["First", "Second"]) {
      await send(context.request, "post", `/api/v1/projects/${key}/tasks`, { title });
    }
    await send(context.request, "post", "/api/v1/teams", { name: `Team ${key}` });
    await send(context.request, "post", `/api/v1/projects/${key}/epics`, { title: `Epic ${key}` });
    if (archive) await send(context.request, "post", `/api/v1/projects/${key}/archive`);
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

function column(page: Page, name: string) {
  return page.getByRole("list", { name }).getByRole("listitem");
}

member(
  "a card opens the task as a dialog over the board at its own URL, and Back closes it",
  async ({ page, browser }) => {
    const key = await seedProject(browser);
    await page.goto(`/projects/${key}`);
    await expect(column(page, "To do")).toHaveCount(2);

    await page.getByRole("link", { name: "First" }).click();

    await expect(page).toHaveURL(new RegExp(`/projects/${key}/tasks/${key}-1$`));
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { level: 1, name: "First" })).toBeVisible();
    await expect(page.locator('[aria-label="Board"]')).toBeAttached();

    await page.goBack();

    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/projects/${key}$`));
    await expect(column(page, "To do")).toHaveCount(2);
  },
);

member(
  "a reload and a direct visit show the task as a page, with no board",
  async ({ page, browser }) => {
    const key = await seedProject(browser);
    await page.goto(`/projects/${key}/tasks/${key}-1`);

    await expect(page.getByRole("heading", { level: 1, name: "First" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Board" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "First" })).toBeVisible();
  },
);

member(
  "a Member edits the fields, moves the task, and the board behind shows it",
  async ({ page, browser }) => {
    const key = await seedProject(browser);
    await page.goto(`/projects/${key}`);
    await page.getByRole("link", { name: "First" }).click();
    const dialog = page.getByRole("dialog");

    await dialog.getByRole("textbox", { name: "Title" }).fill("Renamed task");
    await dialog.getByRole("combobox", { name: "Type" }).click();
    await page.getByRole("option", { name: "Bug" }).click();
    await dialog.getByRole("textbox", { name: "Description" }).fill("Steps: **one**, then two");
    await dialog.getByRole("combobox", { name: "Team" }).click();
    await page.getByRole("option", { name: `Team ${key}` }).click();
    await dialog.getByRole("combobox", { name: "Epic" }).click();
    await page.getByRole("option", { name: `Epic ${key}` }).click();
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog.getByRole("status", { name: "Task messages" })).toContainText(
      "Saved the task.",
    );

    await dialog.getByRole("combobox", { name: "Column" }).click();
    await page.getByRole("option", { name: "Done" }).click();
    await expect(dialog.getByRole("status", { name: "Task messages" })).toContainText("Moved");
    await dialog.getByRole("button", { name: "Close" }).click();

    // The board behind was kept current without a reload.
    await expect(
      page.getByRole("list", { name: "Done" }).getByRole("link", { name: "Renamed task" }),
    ).toBeVisible();
    await expect(column(page, "To do")).toHaveCount(1);

    await page.goto(`/projects/${key}/tasks/${key}-1`);
    await expect(page.getByRole("heading", { level: 1, name: "Renamed task" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Description" })).toHaveValue(
      "Steps: **one**, then two",
    );
    await expect(page.getByRole("combobox", { name: "Type" })).toHaveText("Bug");
    await expect(page.getByRole("combobox", { name: "Team" })).toHaveText(`Team ${key}`);
    await expect(page.getByRole("combobox", { name: "Column" })).toHaveText("Done");
  },
);

member(
  "Markdown in a description and a comment is rendered, and a script or a javascript link is not run",
  async ({ page, browser }) => {
    const key = await seedProject(browser);
    await page.goto(`/projects/${key}/tasks/${key}-1`);
    const nasty =
      '**bold** <script>window.injected = true</script> <img src=x onerror="window.injected = true"> [bad](javascript:window.injected=true) [good](https://example.org/a)';

    await page.getByRole("textbox", { name: "Description" }).fill(nasty);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status", { name: "Task messages" })).toContainText(
      "Saved the task.",
    );
    await page.getByRole("textbox", { name: "New comment" }).fill(nasty);
    await page.getByRole("button", { name: "Add comment" }).click();
    await expect(page.getByRole("list", { name: "Comments" }).getByText("bold")).toBeVisible();

    await page.reload();
    await page.getByRole("tab", { name: "Preview description" }).click();

    expect(await page.evaluate(() => "injected" in window)).toBe(false);
    await expect(page.locator("main script")).toHaveCount(0);
    await expect(page.locator("main img")).toHaveCount(0);
    const bad = page.locator("main a", { hasText: "bad" }).first();
    expect((await bad.getAttribute("href")) ?? "").toBe("");
    const good = page.getByRole("link", { name: "good" }).first();
    await expect(good).toHaveAttribute("href", "https://example.org/a");
    await expect(good).toHaveAttribute("target", "_blank");
  },
);

member(
  "the reporter deletes a task from its dialog; another Member is not offered Delete",
  async ({ page, browser }) => {
    const key = await seedProject(browser);
    const mine = await send(page.request, "post", `/api/v1/projects/${key}/tasks`, {
      title: "Mine",
    });
    expect(mine.id).toBeTruthy();
    const other = await signedInContext(browser, "member");
    try {
      const otherPage = await other.newPage();
      await otherPage.goto(`/projects/${key}/tasks/${key}-3`);
      await expect(otherPage.getByRole("heading", { level: 1, name: "Mine" })).toBeVisible();
      await expect(otherPage.getByRole("button", { name: "Delete task" })).toHaveCount(0);
    } finally {
      await other.close();
    }

    await page.goto(`/projects/${key}`);
    await page.getByRole("link", { name: "Mine" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete task" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(column(page, "To do")).toHaveCount(2);
    await expect(page.getByRole("link", { name: "Mine" })).toHaveCount(0);
  },
);

viewer("a Viewer sees the task with no controls", async ({ page, browser }) => {
  const key = await seedProject(browser);
  await page.goto(`/projects/${key}/tasks/${key}-1`);

  await expect(page.getByRole("heading", { level: 1, name: "First" })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete task" })).toHaveCount(0);
});

member("an archived project shows the task with no controls", async ({ page, browser }) => {
  const key = await seedProject(browser, true);
  await page.goto(`/projects/${key}/tasks/${key}-1`);

  await expect(page.getByText("This project is archived, so the task is read-only.")).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
});

member(
  "a save after someone else changed the task shows the conflict",
  async ({ page, browser }) => {
    const key = await seedProject(browser);
    await page.goto(`/projects/${key}/tasks/${key}-1`);
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("First");

    const other = await signedInContext(browser, "member");
    try {
      await send(other.request, "patch", `/api/v1/tasks/${key}-1`, { title: "Theirs", version: 1 });
    } finally {
      await other.close();
    }
    await page.getByRole("textbox", { name: "Title" }).fill("Mine");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByRole("status", { name: "Task messages" })).toContainText(
      "Someone else changed this task",
    );
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Theirs");
  },
);

for (const colorScheme of ["light", "dark"] as const) {
  member(
    `the page and the dialog fit a phone and have no accessibility violations in ${colorScheme} mode`,
    async ({ page, browser }) => {
      const key = await seedProject(browser);
      await page.setViewportSize({ width: 390, height: 800 });
      await page.emulateMedia({ colorScheme });

      for (const open of [
        async () => {
          await page.goto(`/projects/${key}/tasks/${key}-1`);
        },
        async () => {
          await page.goto(`/projects/${key}`);
          await page.getByRole("link", { name: "First" }).click();
          await expect(page.getByRole("dialog")).toBeVisible();
        },
      ]) {
        await open();
        await expect(page.getByRole("heading", { level: 1, name: "First" })).toBeVisible();
        await expect(page.getByRole("combobox", { name: "Column" })).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze();
        expect(results.violations.map((violation) => violation.id)).toEqual([]);
      }
    },
  );
}
