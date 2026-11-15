import AxeBuilder from "@axe-core/playwright";
import { type APIRequestContext, type Page } from "@playwright/test";

import { expect, test as base } from "./base";
import { E2E_BASE_URL } from "./environment";
import { seedAccount } from "./seed";

const password = "an e2e teams password, long";

async function signIn(request: APIRequestContext, email: string) {
  const response = await request.post("/api/v1/auth/sign-in", {
    headers: { Origin: E2E_BASE_URL },
    data: { email, password },
  });
  expect(response.status()).toBe(200);
}

async function post(request: APIRequestContext, path: string, data: unknown) {
  const response = await request.post(path, { headers: { Origin: E2E_BASE_URL }, data });
  expect(response.status(), path).toBeLessThan(300);
  return (await response.json()) as { id: string };
}

/** A Manager, signed in, with the names of a person to add and of a team the Manager owns. */
const manager = base.extend<{ person: string }>({
  person: async ({ browserName: _browserName }, provide) => {
    const unique = crypto.randomUUID().slice(0, 8);
    await seedAccount({
      email: `person-${unique}@example.com`,
      password,
      role: "member",
      name: `Zelda${unique}`,
    });
    await provide(`Zelda${unique}`);
  },
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

async function showEveryTeam(page: Page) {
  const more = page.getByRole("button", { name: "Load more" });
  while (await more.isVisible()) {
    await more.click();
  }
}

manager(
  "a Manager creates a team, adds and removes a person, renames it and deletes it",
  async ({ page, person }) => {
    const name = `Alpha ${crypto.randomUUID().slice(0, 8)}`;
    await page.goto("/");
    await page.getByRole("link", { name: "Teams" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Teams" })).toBeVisible();

    await page.getByRole("button", { name: "New team" }).click();
    const create = page.getByRole("dialog", { name: "New team" });
    await create.getByLabel("Name").fill(name);
    await create.getByRole("button", { name: "Create team" }).click();
    await showEveryTeam(page);
    await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible();

    await page.getByRole("button", { name: `Manage ${name}` }).click();
    const dialog = page.getByRole("dialog", { name: `Team ${name}` });
    await dialog.getByRole("searchbox", { name: "Add a person" }).fill(person);
    await dialog.getByRole("button", { name: `Add ${person}` }).click();
    await expect(dialog.getByRole("list", { name: "Members" })).toContainText(person);

    await dialog.getByRole("button", { name: `Remove ${person}` }).click();
    await expect(dialog.getByText("No members yet.")).toBeVisible();

    const renamed = `${name} renamed`;
    await dialog.getByRole("textbox", { name: "Team name" }).fill(renamed);
    await dialog.getByRole("button", { name: "Rename" }).click();
    await expect(page.getByRole("dialog", { name: `Team ${renamed}` })).toBeVisible();

    await dialog.getByRole("button", { name: "Delete team" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("status")).toContainText(`Deleted ${renamed}.`);
    await expect(page.getByRole("row", { name: new RegExp(renamed) })).toHaveCount(0);
  },
);

manager(
  "a team that a task is assigned to cannot be deleted, and the page says why",
  async ({ page }) => {
    const name = `Busy ${crypto.randomUUID().slice(0, 8)}`;
    const key = `T${crypto.randomUUID().replace(/\D/g, "").slice(0, 5).padEnd(2, "0")}`;
    const team = await post(page.request, "/api/v1/teams", { name });
    await post(page.request, "/api/v1/projects", { key, name: `Project ${key}` });
    await post(page.request, `/api/v1/projects/${key}/tasks`, {
      title: "Assigned",
      assigneeTeamId: team.id,
    });

    await page.goto("/teams");
    await showEveryTeam(page);
    await page.getByRole("button", { name: `Manage ${name}` }).click();
    await page
      .getByRole("dialog", { name: `Team ${name}` })
      .getByRole("button", { name: "Delete team" })
      .click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();

    await expect(page.getByRole("status")).toContainText(
      "Tasks are assigned to this team. Reassign them first.",
    );
    await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible();
  },
);

member(
  "a Member sees the teams and their members and none of the management controls",
  async ({ page, browser }) => {
    const name = `Seen ${crypto.randomUUID().slice(0, 8)}`;
    // A Manager, in a context of their own, creates the team.
    const context = await browser.newContext({ baseURL: E2E_BASE_URL });
    try {
      const email = `manager-${crypto.randomUUID()}@example.com`;
      await seedAccount({ email, password, role: "manager" });
      await signIn(context.request, email);
      await post(context.request, "/api/v1/teams", { name });
    } finally {
      await context.close();
    }

    await page.goto("/");
    await page.getByRole("link", { name: "Teams" }).click();
    await expect(page.getByRole("link", { name: "People" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New team" })).toHaveCount(0);
    await showEveryTeam(page);
    await page.getByRole("button", { name: `Members of ${name}` }).click();
    const dialog = page.getByRole("dialog", { name: `Team ${name}` });
    await expect(dialog.getByText("No members yet.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Delete team" })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Rename" })).toHaveCount(0);
  },
);

for (const colorScheme of ["light", "dark"] as const) {
  manager(
    `the page fits a phone and has no accessibility violations in ${colorScheme} mode`,
    async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 800 });
      await page.emulateMedia({ colorScheme });
      await page.goto("/teams");
      await expect(page.getByRole("heading", { level: 1, name: "Teams" })).toBeVisible();
      await expect(page.getByRole("table")).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      await page.getByRole("button", { name: "New team" }).click();
      await expect(page.getByRole("dialog", { name: "New team" })).toBeVisible();

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations.map((violation) => violation.id)).toEqual([]);
    },
  );
}
