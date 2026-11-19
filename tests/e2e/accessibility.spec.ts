import AxeBuilder from "@axe-core/playwright";
import { type Page } from "@playwright/test";

import { expect, test } from "./base";
import { E2E_BASE_URL } from "./environment";
import { seedAccount } from "./seed";

for (const colorScheme of ["light", "dark"] as const) {
  test(`the home page has no accessibility violations in ${colorScheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`the teams pages have no accessibility violations in ${colorScheme} mode`, async ({
    page,
  }) => {
    const email = `a11y-${crypto.randomUUID()}@example.com`;
    const password = "an e2e accessibility password";
    await seedAccount({ email, password, role: "manager", name: "Axe Manager" });
    const headers = { Origin: E2E_BASE_URL };
    expect(
      (
        await page.request.post("/api/v1/auth/sign-in", { headers, data: { email, password } })
      ).status(),
    ).toBe(200);
    const created = await page.request.post("/api/v1/teams", {
      headers,
      data: { name: `Axe ${crypto.randomUUID()}` },
    });
    const { id } = (await created.json()) as { id: string };
    await page.emulateMedia({ colorScheme });

    for (const [path, loaded] of [
      ["/teams", page.getByRole("table")],
      [`/teams/${id}`, page.getByText("No members yet.")],
    ] as const) {
      await page.goto(path);
      await expect(loaded).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(
        results.violations.map((violation) => violation.id),
        path,
      ).toEqual([]);
    }
  });
}

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function violations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations.map((violation) => violation.id);
}

/**
 * Signs `page` in as a new Manager and creates a project with one task; returns the
 * project's key. Each projects check below starts from its own, so that each stays short
 * (WS-054).
 */
async function projectWithATask(page: Page): Promise<string> {
  const email = `a11y-${crypto.randomUUID()}@example.com`;
  const password = "an e2e accessibility password";
  await seedAccount({ email, password, role: "manager", name: "Axe Manager" });
  const headers = { Origin: E2E_BASE_URL };
  expect(
    (
      await page.request.post("/api/v1/auth/sign-in", { headers, data: { email, password } })
    ).status(),
  ).toBe(200);
  const key = `A${crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
  expect(
    (await page.request.post("/api/v1/projects", { headers, data: { key, name: key } })).status(),
  ).toBe(201);
  expect(
    (
      await page.request.post(`/api/v1/projects/${key}/tasks`, {
        headers,
        data: { title: "A card on the board" },
      })
    ).status(),
  ).toBe(201);
  return key;
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`the projects pages have no accessibility violations in ${colorScheme} mode`, async ({
    page,
  }) => {
    const key = await projectWithATask(page);
    await page.emulateMedia({ colorScheme });

    for (const [path, loaded] of [
      ["/projects", page.getByRole("table")],
      [`/projects/${key}`, page.getByRole("button", { name: /A card on the board/ })],
      [`/projects/${key}/tasks/${key}-1`, page.getByRole("region", { name: "Comments" })],
      [`/projects/${key}/settings`, page.getByRole("row", { name: /In progress/ })],
    ] as const) {
      await page.goto(path);
      await expect(loaded).toBeVisible();
      expect(await violations(page), path).toEqual([]);
    }
  });

  test(`the epics page and an epic's dialog have no accessibility violations in ${colorScheme} mode`, async ({
    page,
  }) => {
    const key = await projectWithATask(page);
    await page.emulateMedia({ colorScheme });

    // The epics page and an epic's dialog (WS-039).
    expect(
      (
        await page.request.post(`/api/v1/projects/${key}/epics`, {
          headers: { Origin: E2E_BASE_URL },
          data: { title: "An epic", description: "With **Markdown**." },
        })
      ).status(),
    ).toBe(201);
    await page.goto(`/projects/${key}/epics`);
    await page.getByRole("button", { name: "An epic" }).click();
    await expect(page.getByRole("dialog", { name: "An epic" })).toBeVisible();
    expect(await violations(page), "epic dialog").toEqual([]);
    await page.keyboard.press("Escape");
    expect(await violations(page), "epics page").toEqual([]);
  });

  test(`the task dialog over the board has no accessibility violations in ${colorScheme} mode`, async ({
    page,
  }) => {
    const key = await projectWithATask(page);
    await page.emulateMedia({ colorScheme });

    // The task as a dialog over the board (WS-038).
    await page.goto(`/projects/${key}`);
    await page.getByRole("link", { name: "A card on the board" }).click();
    await expect(page.getByRole("dialog").getByRole("region", { name: "Comments" })).toBeVisible();
    expect(await violations(page), "task dialog").toEqual([]);
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`the Agents pages and the token dialog have no accessibility violations in ${colorScheme} mode (WS-077)`, async ({
    page,
  }) => {
    const email = `a11y-agents-${crypto.randomUUID()}@example.com`;
    const password = "an e2e accessibility password";
    await seedAccount({ email, password, role: "admin", name: "Axe Admin" });
    const headers = { Origin: E2E_BASE_URL };
    expect(
      (
        await page.request.post("/api/v1/auth/sign-in", { headers, data: { email, password } })
      ).status(),
    ).toBe(200);
    const created = await page.request.post("/api/v1/agents", {
      headers,
      data: { name: `Axe bot ${crypto.randomUUID()}`, role: "worker_agent", projectIds: null },
    });
    expect(created.status()).toBe(201);
    const { id } = (await created.json()) as { id: string };
    await page.emulateMedia({ colorScheme });
    const axe = async () =>
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations.map((violation) => violation.id);

    await page.goto("/agents");
    await expect(page.getByRole("heading", { name: "Agents", level: 1 })).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
    expect(await axe()).toEqual([]);

    await page.goto(`/agents/${id}`);
    await expect(page.getByRole("heading", { name: "Tokens" })).toBeVisible();
    expect(await axe()).toEqual([]);

    await page.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await axe()).toEqual([]);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Create token" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Token name").fill("Axe");
    await dialog.getByRole("button", { name: "Create token" }).click();
    await expect(dialog.getByLabel("Token", { exact: true })).toHaveValue(/^opk_/);
    expect(await axe()).toEqual([]);
  });
}
