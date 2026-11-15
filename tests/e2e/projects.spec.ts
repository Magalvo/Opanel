import AxeBuilder from "@axe-core/playwright";
import { type APIRequestContext, expect, type Page, test as base } from "@playwright/test";

import { E2E_BASE_URL } from "./environment";
import { seedAccount } from "./seed";

const password = "an e2e projects password, long";

async function signIn(request: APIRequestContext, email: string) {
  const response = await request.post("/api/v1/auth/sign-in", {
    headers: { Origin: E2E_BASE_URL },
    data: { email, password },
  });
  expect(response.status()).toBe(200);
}

async function send(
  request: APIRequestContext,
  method: "post" | "delete",
  path: string,
  data?: unknown,
) {
  const response = await request[method](path, {
    headers: { Origin: E2E_BASE_URL },
    ...(data === undefined ? {} : { data }),
  });
  expect(response.status(), path).toBeLessThan(300);
  return response.status() === 204 ? null : ((await response.json()) as { id: string });
}

/** A key no other test of the run uses: the end-to-end database keeps every project. */
function newKey(): string {
  return `E${String(Date.now()).slice(-7)}${String(Math.floor(Math.random() * 10))}`;
}

const manager = base.extend({
  page: async ({ page }, provide) => {
    const email = `manager-${crypto.randomUUID()}@example.com`;
    await seedAccount({ email, password, role: "manager" });
    await signIn(page.request, email);
    await provide(page);
  },
});

const member = base.extend({
  page: async ({ page }, provide) => {
    const email = `member-${crypto.randomUUID()}@example.com`;
    await seedAccount({ email, password, role: "member" });
    await signIn(page.request, email);
    await provide(page);
  },
});

async function showEveryProject(page: Page) {
  const more = page.getByRole("button", { name: "Load more" });
  while (await more.isVisible()) {
    await more.click();
  }
}

manager(
  "a Manager creates a project, edits it, manages its columns, and archives and unarchives it",
  async ({ page }) => {
    const key = newKey();
    await page.goto("/");
    await page.getByRole("link", { name: "Projects" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();

    await page.getByRole("button", { name: "New project" }).click();
    const create = page.getByRole("dialog", { name: "New project" });
    await create.getByLabel("Key").fill(key.toLowerCase());
    await create.getByLabel("Name").fill("Settings project");
    await create.getByRole("button", { name: "Create project" }).click();

    await expect(page).toHaveURL(new RegExp(`/projects/${key}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Settings project" })).toBeVisible();
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${key}/settings$`));

    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Renamed project");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toContainText("Saved the details.");

    await page.getByRole("textbox", { name: "New column name" }).fill("Review");
    await page.getByRole("button", { name: "Add column" }).click();
    await expect(page.getByRole("textbox", { name: "Name of Review" })).toBeVisible();

    await page.getByRole("textbox", { name: "Name of Review" }).fill("QA");
    await page.getByRole("button", { name: "Rename Review" }).click();
    await expect(page.getByRole("textbox", { name: "Name of QA" })).toBeVisible();

    await page.getByRole("button", { name: "Move QA earlier" }).click();
    const names = page.getByRole("list", { name: "Columns" }).getByRole("textbox");
    await expect(names.nth(2)).toHaveValue("QA");

    await page.getByRole("button", { name: "Delete QA" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("textbox", { name: "Name of QA" })).toHaveCount(0);

    await page.getByRole("button", { name: "Archive project" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Archive" }).click();
    await expect(page.getByText("This project is archived, so it is read-only.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add column" })).toBeDisabled();

    await page.getByRole("button", { name: "Unarchive project" }).click();
    await expect(page.getByRole("button", { name: "Add column" })).toBeEnabled();
  },
);

manager(
  "a deleted task is restored from the settings, and a column that holds a task cannot be deleted",
  async ({ page }) => {
    const key = newKey();
    await send(page.request, "post", "/api/v1/projects", { key, name: "Rules project" });
    await send(page.request, "post", `/api/v1/projects/${key}/tasks`, { title: "Keep me" });
    await send(page.request, "post", `/api/v1/projects/${key}/tasks`, { title: "Delete me" });
    await send(page.request, "delete", `/api/v1/tasks/${key}-2`);

    await page.goto(`/projects/${key}/settings`);
    await page.getByRole("button", { name: "Delete To do" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("status")).toContainText(
      "This column still has tasks. Move or delete them first.",
    );
    await expect(page.getByRole("textbox", { name: "Name of To do" })).toBeVisible();

    await page.getByRole("button", { name: "Show deleted tasks" }).click();
    const deleted = page.getByRole("list", { name: "Deleted tasks" });
    await expect(deleted).toContainText(`${key}-2`);
    await page.getByRole("button", { name: `Restore ${key}-2` }).click();
    await expect(page.getByRole("status")).toContainText(`Restored ${key}-2.`);
    await expect(page.getByText("No deleted tasks.")).toBeVisible();
  },
);

member(
  "a Member sees the projects and a project, without New project or Settings, and settings is not found",
  async ({ browser, page }) => {
    const key = newKey();
    const context = await browser.newContext({ baseURL: E2E_BASE_URL });
    try {
      const email = `manager-${crypto.randomUUID()}@example.com`;
      await seedAccount({ email, password, role: "manager" });
      await signIn(context.request, email);
      await send(context.request, "post", "/api/v1/projects", { key, name: "Seen project" });
    } finally {
      await context.close();
    }

    await page.goto("/projects");
    await expect(page.getByRole("button", { name: "New project" })).toHaveCount(0);
    await showEveryProject(page);
    await page.getByRole("link", { name: "Seen project" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Seen project" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);

    const response = await page.goto(`/projects/${key}/settings`);

    expect(response?.status()).toBe(404);
  },
);

for (const colorScheme of ["light", "dark"] as const) {
  manager(
    `the pages fit a phone and have no accessibility violations in ${colorScheme} mode`,
    async ({ page }) => {
      const key = newKey();
      await send(page.request, "post", "/api/v1/projects", { key, name: "Phone project" });
      await page.setViewportSize({ width: 390, height: 800 });
      await page.emulateMedia({ colorScheme });

      for (const path of ["/projects", `/projects/${key}/settings`]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, path).toBeLessThanOrEqual(0);
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze();
        expect(
          results.violations.map((violation) => violation.id),
          path,
        ).toEqual([]);
      }
    },
  );
}
