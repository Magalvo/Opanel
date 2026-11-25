import AxeBuilder from "@axe-core/playwright";
import { type Locator, type Page } from "@playwright/test";

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
      [`/projects/${key}/tasks/${key}-1`, page.getByRole("region", { name: "Activity" })],
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
    await expect(page.getByRole("dialog").getByRole("region", { name: "Activity" })).toBeVisible();
    expect(await violations(page), "task dialog").toEqual([]);
  });

  test(`a task's timeline with changes has no accessibility violations in ${colorScheme} mode (WS-119)`, async ({
    page,
  }) => {
    const key = await projectWithATask(page);
    await page.emulateMedia({ colorScheme });
    const headers = { Origin: E2E_BASE_URL };
    const task = (await (await page.request.get(`/api/v1/tasks/${key}-1`)).json()) as {
      version: number;
    };
    expect(
      (
        await page.request.patch(`/api/v1/tasks/${key}-1`, {
          headers,
          data: { description: "A **new** description", priority: "high", version: task.version },
        })
      ).status(),
    ).toBe(200);

    await page.goto(`/projects/${key}/tasks/${key}-1`);
    const timeline = page.getByRole("region", { name: "Activity" });
    await timeline.getByRole("button", { name: "Show changes" }).click();
    await expect(timeline.getByText("A **new** description")).toBeVisible();
    expect(await violations(page), "timeline").toEqual([]);
  });

  test(`the filtered board and backlog have no accessibility violations in ${colorScheme} mode (WS-120)`, async ({
    page,
  }) => {
    const key = await projectWithATask(page);
    await page.emulateMedia({ colorScheme });

    for (const path of [`/projects/${key}?type=bug&q=card`, `/projects/${key}/backlog?type=bug`]) {
      await page.goto(path);
      const bar = page.getByRole("search", { name: "Filter tasks" });
      await expect(bar.getByRole("button", { name: "Clear filters" })).toBeVisible();
      expect(await violations(page), path).toEqual([]);
      await bar.getByRole("button", { name: "Type", exact: true }).click();
      await expect(page.getByRole("menu")).toBeVisible();
      expect(await violations(page), `${path}, menu open`).toEqual([]);
      await page.keyboard.press("Escape");
    }
  });

  test(`the Backlog page and a task over it have no accessibility violations in ${colorScheme} mode (WS-109)`, async ({
    page,
  }) => {
    const key = await projectWithATask(page);
    await page.emulateMedia({ colorScheme });
    for (const title of ["A task in the backlog", "Another one"]) {
      expect(
        (
          await page.request.post(`/api/v1/projects/${key}/tasks`, {
            headers: { Origin: E2E_BASE_URL },
            data: { title, type: "bug", columnId: null },
          })
        ).status(),
      ).toBe(201);
    }

    await page.goto(`/projects/${key}/backlog`);
    await expect(page.getByRole("button", { name: `Move to board ${key}-3` })).toBeVisible();
    expect(await violations(page), "backlog").toEqual([]);

    await page.getByRole("link", { name: "A task in the backlog" }).click();
    await expect(page.getByRole("dialog").getByRole("region", { name: "Activity" })).toBeVisible();
    expect(await violations(page), "task dialog over the backlog").toEqual([]);
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

const COLOURS = [
  "gray",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "indigo",
  "purple",
  "pink",
] as const;

for (const colorScheme of ["light", "dark"] as const) {
  test(`labels of every colour have no accessibility violations in ${colorScheme} mode (WS-108)`, async ({
    page,
  }) => {
    const key = await projectWithATask(page);
    const headers = { Origin: E2E_BASE_URL };
    const labelIds: string[] = [];
    for (const colour of COLOURS) {
      const created = await page.request.post(`/api/v1/projects/${key}/labels`, {
        headers,
        data: { name: `Label ${colour}`, colour },
      });
      expect(created.status()).toBe(201);
      labelIds.push(((await created.json()) as { id: string }).id);
    }
    expect(
      (
        await page.request.patch(`/api/v1/tasks/${key}-1`, {
          headers,
          data: { labelIds, version: 1 },
        })
      ).status(),
    ).toBe(200);
    await page.emulateMedia({ colorScheme });

    for (const [path, loaded] of [
      [`/projects/${key}`, page.getByRole("list", { name: "Labels" }).first()],
      [`/projects/${key}/tasks/${key}-1`, page.getByRole("group", { name: "Labels" })],
      [`/projects/${key}/settings`, page.getByRole("row", { name: /Label pink/ })],
    ] as const) {
      await page.goto(path);
      await expect(loaded).toBeVisible();
      expect(await violations(page), path).toEqual([]);
    }
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`priorities and an overdue date have no accessibility violations in ${colorScheme} mode (WS-110)`, async ({
    page,
  }) => {
    const key = await projectWithATask(page);
    const headers = { Origin: E2E_BASE_URL };
    // The viewer's today is fixed, so the past date below is overdue.
    await page.clock.setFixedTime(new Date("2030-06-15T12:00:00"));
    for (const [title, data] of [
      ["Low one", { priority: "low" }],
      ["Medium one", { priority: "medium" }],
      ["High one", { priority: "high", dueDate: "2030-07-01" }],
      ["Urgent and overdue", { priority: "urgent", dueDate: "2030-06-01" }],
      ["Overdue in the backlog", { priority: "high", dueDate: "2030-06-01", columnId: null }],
    ] as const) {
      expect(
        (
          await page.request.post(`/api/v1/projects/${key}/tasks`, {
            headers,
            data: { title, ...data },
          })
        ).status(),
      ).toBe(201);
    }
    await page.emulateMedia({ colorScheme });

    await page.goto(`/projects/${key}`);
    await expect(page.getByText("Overdue, due Jun 1, 2030")).toBeVisible();
    expect(await violations(page), "board").toEqual([]);

    await page.goto(`/projects/${key}/backlog`);
    await expect(page.getByText("Overdue, due Jun 1, 2030")).toBeVisible();
    expect(await violations(page), "backlog").toEqual([]);

    await page.goto(`/projects/${key}`);
    await page.getByRole("link", { name: "Urgent and overdue" }).click();
    await expect(page.getByRole("dialog").getByLabel("Due date")).toHaveValue("2030-06-01");
    expect(await violations(page), "task dialog").toEqual([]);
  });
}

/** axe on the page as it is, then again with the pointer over `hovered` (WS-129, test 7). */
async function checkAtRestAndHovered(page: Page, hovered: Locator, where: string) {
  await expect(hovered).toBeVisible();
  expect(await violations(page), where).toEqual([]);
  await hovered.hover();
  expect(await violations(page), `${where}, hovered`).toEqual([]);
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`destructive buttons and menu items have no accessibility violations in ${colorScheme} mode (WS-129)`, async ({
    page,
  }) => {
    test.slow();
    const email = `a11y-destructive-${crypto.randomUUID()}@example.com`;
    const password = "an e2e accessibility password";
    await seedAccount({ email, password, role: "admin", name: "Axe Admin" });
    const headers = { Origin: E2E_BASE_URL };
    expect(
      (
        await page.request.post("/api/v1/auth/sign-in", { headers, data: { email, password } })
      ).status(),
    ).toBe(200);
    const team = await page.request.post("/api/v1/teams", {
      headers,
      data: { name: `Axe ${crypto.randomUUID()}` },
    });
    expect(team.status()).toBe(201);
    const teamId = ((await team.json()) as { id: string }).id;
    const agent = await page.request.post("/api/v1/agents", {
      headers,
      data: { name: `Axe bot ${crypto.randomUUID()}`, role: "worker_agent", projectIds: null },
    });
    expect(agent.status()).toBe(201);
    const agentId = ((await agent.json()) as { id: string }).id;
    const key = `D${crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
    expect(
      (await page.request.post("/api/v1/projects", { headers, data: { key, name: key } })).status(),
    ).toBe(201);
    await page.emulateMedia({ colorScheme });
    const confirmation = page.getByRole("alertdialog");

    // People: a person's menu, focused on "Deactivate", then its confirmation.
    await page.goto("/people");
    const row = page
      .getByRole("row")
      .filter({ has: page.getByRole("button", { name: /^Actions for/ }) })
      .filter({ hasNotText: "Deactivated" })
      .first();
    await row.getByRole("button", { name: /^Actions for/ }).click();
    const deactivate = page.getByRole("menuitem", { name: "Deactivate" });
    await deactivate.hover();
    await expect(deactivate).toBeFocused();
    // The menu only: while a Radix menu is open the page behind it is `aria-hidden`, which
    // axe reports as `aria-hidden-focus` whatever the colours (WS-129, implementation).
    const menu = await new AxeBuilder({ page }).include('[role="menu"]').withTags(TAGS).analyze();
    expect(
      menu.violations.map((violation) => violation.id),
      "People, menu",
    ).toEqual([]);
    await deactivate.click();
    await checkAtRestAndHovered(
      page,
      confirmation.getByRole("button", { name: "Deactivate" }),
      "People, confirmation",
    );
    await confirmation.getByRole("button", { name: "Cancel" }).click();

    // A team: "Delete team" and its confirmation.
    await page.goto(`/teams/${teamId}`);
    await checkAtRestAndHovered(page, page.getByRole("button", { name: "Delete team" }), "team");
    await page.getByRole("button", { name: "Delete team" }).click();
    await checkAtRestAndHovered(
      page,
      confirmation.getByRole("button", { name: "Delete" }),
      "team, confirmation",
    );
    await confirmation.getByRole("button", { name: "Cancel" }).click();

    // An agent: "Disable agent" and its confirmation.
    await page.goto(`/agents/${agentId}`);
    const disable = page.getByRole("button", { name: "Disable agent" });
    await checkAtRestAndHovered(page, disable, "agent");
    await disable.click();
    await checkAtRestAndHovered(
      page,
      confirmation.getByRole("button", { name: /^Disable/ }),
      "agent, confirmation",
    );
    await confirmation.getByRole("button", { name: "Cancel" }).click();

    // A project's settings: "Archive project", and the confirmation to delete a column.
    await page.goto(`/projects/${key}/settings`);
    const columns = page.getByRole("region", { name: "Columns" });
    await expect(columns.getByRole("row", { name: /Done/ })).toBeVisible();
    await checkAtRestAndHovered(
      page,
      page.getByRole("button", { name: "Archive project" }),
      "settings",
    );
    await page.getByRole("button", { name: "Delete Done" }).click();
    await checkAtRestAndHovered(
      page,
      confirmation.getByRole("button", { name: "Delete" }),
      "settings, delete column",
    );
    await confirmation.getByRole("button", { name: "Cancel" }).click();
  });
}

for (const reducedMotion of ["reduce", "no-preference"] as const) {
  test(`a loading skeleton ${reducedMotion === "reduce" ? "is still" : "pulses"} with reducedMotion "${reducedMotion}" (WS-129)`, async ({
    page,
  }) => {
    const email = `a11y-skeleton-${crypto.randomUUID()}@example.com`;
    const password = "an e2e accessibility password";
    await seedAccount({ email, password, role: "manager", name: "Axe Manager" });
    expect(
      (
        await page.request.post("/api/v1/auth/sign-in", {
          headers: { Origin: E2E_BASE_URL },
          data: { email, password },
        })
      ).status(),
    ).toBe(200);
    // Holds the teams list back, so the page stays on its skeleton.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/\/api\/v1\/teams\?/, async (route) => {
      await held;
      await route.continue();
    });
    await page.emulateMedia({ reducedMotion });

    await page.goto("/teams");
    const skeleton = page.locator('[data-slot="skeleton"]').first();
    await expect(skeleton).toBeVisible();
    const animation = await skeleton.evaluate((element) => ({
      name: getComputedStyle(element).animationName,
      running: element.getAnimations().length,
    }));
    release();

    expect(animation).toEqual(
      reducedMotion === "reduce" ? { name: "none", running: 0 } : { name: "pulse", running: 1 },
    );
  });
}
