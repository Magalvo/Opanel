// Bugs in the UI (WS-091): an agent files reports through the API with its token, and people
// see the severity and count on the board, and the reports and links in the task detail.
import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";
import { request as playwrightRequest } from "@playwright/test";

import { expect, test } from "./base";
import { E2E_BASE_URL } from "./environment";
import { seedAccount, seedAgent, seedAgentToken } from "./seed";

const password = "an e2e bugs password, long enough";
const headers = { Origin: E2E_BASE_URL };

interface Setup {
  key: string;
  botName: string;
  agent: APIRequestContext;
}

/** Signs `page` in as a new Manager with a new project, and gives an agent a token. */
async function setUp(page: Page): Promise<Setup> {
  const id = crypto.randomUUID().slice(0, 8);
  const email = `bugs-${id}@example.com`;
  await seedAccount({ email, password, role: "manager", name: `Manager ${id}` });
  expect(
    (
      await page.request.post("/api/v1/auth/sign-in", { headers, data: { email, password } })
    ).status(),
  ).toBe(200);
  const key = `G${id.replace(/-/g, "").slice(0, 7).toUpperCase()}`;
  expect(
    (
      await page.request.post("/api/v1/projects", { headers, data: { key, name: `Bugs ${key}` } })
    ).status(),
  ).toBe(201);
  const botName = `QA Bot ${id}`;
  const token = await seedAgentToken(await seedAgent(botName));
  const agent = await playwrightRequest.newContext({
    baseURL: E2E_BASE_URL,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
  return { key, botName, agent };
}

const FINGERPRINT = "frontend:/login:TypeError";

async function file(
  setup: Setup,
  extra: Record<string, unknown> = {},
): Promise<{ outcome: string; taskKey: string }> {
  const response = await setup.agent.post(`/api/v1/projects/${setup.key}/bug-reports`, {
    data: {
      title: "The login page crashes",
      fingerprint: FINGERPRINT,
      originLayer: "frontend",
      severity: "high",
      confidence: 0.9,
      runId: "run-1",
      summary: "Signing in throws.",
      evidence: {
        stepsToReproduce: ["Open /login", "Press Sign in"],
        expected: "Signed in",
        actual: "A blank page",
        consoleErrors: ["TypeError: user is undefined"],
      },
      ...extra,
    },
  });
  expect([200, 201]).toContain(response.status());
  return (await response.json()) as { outcome: string; taskKey: string };
}

test("an agent's reports show on the card and in the detail; a regression links back (WS-091)", async ({
  page,
}) => {
  const setup = await setUp(page);
  const { key, botName } = setup;
  const created = await file(setup);
  expect(created.outcome).toBe("created");
  await file(setup, { runId: "run-2" });
  await file(setup, { runId: "run-3" });

  // The board: severity and count on the card.
  await page.goto(`/projects/${key}`);
  const card = page.getByRole("listitem").filter({ hasText: "The login page crashes" });
  await expect(card).toContainText("Severity: High");
  await expect(card).toContainText("3 reports");

  // The detail: count, reports with the agent, evidence.
  await card.getByRole("link", { name: "The login page crashes" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/^Reported 3 times, last on /)).toBeVisible();
  const reports = dialog.getByRole("region", { name: "Reports" });
  await expect(reports.getByRole("article")).toHaveCount(3);
  await expect(reports.getByRole("article").first()).toContainText(`${botName}Agent`);
  await expect(reports.getByRole("article").first()).toContainText("run-3");
  await reports.getByRole("article").first().getByText("Evidence").click();
  await expect(reports.getByText("TypeError: user is undefined").first()).toBeVisible();

  // The Manager corrects the severity; the card follows.
  const details = dialog.getByRole("region", { name: "Details" });
  await details.getByLabel("Severity").selectOption("critical");
  await details.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog.getByRole("status", { name: "Task messages" })).toHaveText("Saved.");
  await page.goBack();
  await expect(card).toContainText("Severity: Critical");

  // Closed, then reported again: a regression that links back to the closed bug.
  const columns = (await (await page.request.get(`/api/v1/projects/${key}/columns`)).json()) as {
    items: { id: string; category: string }[];
  };
  const doneColumn = columns.items.find((column) => column.category === "done");
  if (doneColumn === undefined) throw new Error("no done column");
  const bug = (await (await page.request.get(`/api/v1/tasks/${created.taskKey}`)).json()) as {
    version: number;
  };
  expect(
    (
      await page.request.post(`/api/v1/tasks/${created.taskKey}/move`, {
        headers,
        data: { columnId: doneColumn.id, version: bug.version },
      })
    ).status(),
  ).toBe(200);
  const regression = await file(setup, { runId: "run-4" });
  expect(regression.outcome).toBe("created");

  await page.goto(`/projects/${key}/tasks/${regression.taskKey}`);
  const links = page.getByRole("region", { name: "Links" });
  await expect(links.getByText("Regression of")).toBeVisible();
  await links.getByRole("link", { name: `${created.taskKey} The login page crashes` }).click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${created.taskKey}$`));
  const back = page.getByRole("region", { name: "Links" });
  await expect(back.getByText("Regressed by")).toBeVisible();
  await expect(
    back.getByRole("link", { name: `${regression.taskKey} The login page crashes` }),
  ).toBeVisible();

  await setup.agent.dispose();
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`a bug's detail with reports is accessible in ${colorScheme} mode (WS-091)`, async ({
    page,
  }) => {
    const setup = await setUp(page);
    const created = await file(setup);
    await file(setup, { runId: "run-2" });
    await page.emulateMedia({ colorScheme });

    await page.goto(`/projects/${setup.key}`);
    await expect(page.getByRole("listitem").filter({ hasText: "2 reports" })).toBeVisible();
    await page.goto(`/projects/${setup.key}/tasks/${created.taskKey}`);
    const reports = page.getByRole("region", { name: "Reports" });
    await expect(reports.getByRole("article")).toHaveCount(2);
    await reports.getByRole("article").first().getByText("Evidence").click();

    for (const where of ["detail", "board"] as const) {
      if (where === "board") await page.goto(`/projects/${setup.key}`);
      if (where === "board") await expect(page.getByText("2 reports")).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations.map((violation) => violation.id)).toEqual([]);
    }
    await setup.agent.dispose();
  });
}

test("at phone width a bug's detail with long evidence has no horizontal page scroll (WS-091)", async ({
  page,
}) => {
  const setup = await setUp(page);
  const created = await file(setup, {
    evidence: {
      consoleErrors: [`TypeError: ${"x".repeat(400)}`],
      http: { method: "GET", path: `/api/${"segment/".repeat(60)}`, status: 500 },
    },
  });
  await page.setViewportSize({ width: 375, height: 800 });

  await page.goto(`/projects/${setup.key}/tasks/${created.taskKey}`);
  const reports = page.getByRole("region", { name: "Reports" });
  await reports.getByRole("article").first().getByText("Evidence").click();
  await expect(reports.getByText(/^TypeError: x+$/)).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await setup.agent.dispose();
});
