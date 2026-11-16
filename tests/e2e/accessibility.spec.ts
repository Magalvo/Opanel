import AxeBuilder from "@axe-core/playwright";

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

for (const colorScheme of ["light", "dark"] as const) {
  test(`the projects pages have no accessibility violations in ${colorScheme} mode`, async ({
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
    await page.emulateMedia({ colorScheme });

    for (const [path, loaded] of [
      ["/projects", page.getByRole("table")],
      [`/projects/${key}`, page.getByRole("button", { name: /A card on the board/ })],
      [`/projects/${key}/settings`, page.getByRole("row", { name: /In progress/ })],
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
