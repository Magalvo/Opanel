// The triage flow end to end (WS-094 section 1): an Admin sets up teams, a project's triage
// settings and an agent with its token; the agent files reports through the API; two people
// see each bug arrive live on their open boards, at the top of the first column, assigned to
// the team of its layer; a repeat counts on it; the detail shows what triage did.
import type { APIRequestContext, Browser, Locator, Page } from "@playwright/test";

import { expect, test } from "./base";
import { E2E_BASE_URL } from "./environment";
import { seedAccount } from "./seed";

const password = "an e2e triage flow password, long";
const headers = { Origin: E2E_BASE_URL };

test.afterEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close();
});

/** A signed-in person in a browser context of its own. */
async function person(browser: Browser, role: "admin" | "member", id: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL });
  const page = await context.newPage();
  const email = `triage-${role}-${id.toLowerCase()}@example.com`;
  await seedAccount({ email, password, role, name: `Triage ${role} ${id}` });
  const response = await page.request.post("/api/v1/auth/sign-in", {
    headers,
    data: { email, password },
  });
  expect(response.status()).toBe(200);
  return page;
}

async function created<T>(page: Page, path: string, data: unknown): Promise<T> {
  const response = await page.request.post(path, { headers, data });
  expect(response.status(), `POST ${path}`).toBe(201);
  return (await response.json()) as T;
}

/** Opens the board and waits until it is loaded with its stream open. */
async function openBoard(page: Page, key: string): Promise<void> {
  const stream = page.waitForResponse((response) => response.url().endsWith("/events"));
  await page.goto(`/projects/${key}`);
  expect((await stream).status()).toBe(200);
  await expect(page.getByRole("region", { name: "Board" })).toBeVisible();
}

function firstColumnCards(page: Page): Locator {
  return page.getByRole("region", { name: /^To do/ }).getByRole("listitem");
}

interface Answer {
  status: number;
  body: {
    outcome?: string;
    taskId?: string;
    taskKey?: string;
    assignedTeamId?: string | null;
    occurrences?: number;
  };
}

async function file(agent: APIRequestContext, key: string, report: unknown): Promise<Answer> {
  const response = await agent.post(`/api/v1/projects/${key}/bug-reports`, { data: report });
  return { status: response.status(), body: (await response.json()) as Answer["body"] };
}

const REPORT = {
  title: "Checkout answers 500",
  originLayer: "api",
  confidence: 0.8,
  severity: "high",
  fingerprint: "api:POST /api/orders:500 TypeError",
  summary: "Placing an order fails.",
  evidence: {
    stepsToReproduce: ["Add an item to the cart", "Press Place order"],
    expected: "The order is placed",
    actual: "An error page",
    http: { method: "POST", path: "/api/orders", status: 500 },
  },
  runId: "run-1",
};

test("an agent's report becomes a bug on every open board, routed by layer, and a repeat counts on it (WS-094)", async ({
  browser,
  playwright,
}) => {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase();
  const admin = await person(browser, "admin", id);

  // 1. Setup through the API, as the Admin: teams, projects, triage settings, the agent.
  const apiTeam = await created<{ id: string; name: string }>(admin, "/api/v1/teams", {
    name: `API team ${id}`,
  });
  const triageTeam = await created<{ id: string; name: string }>(admin, "/api/v1/teams", {
    name: `Triage team ${id}`,
  });
  const [key, other] = [`T${id}`, `U${id}`];
  const project = await created<{ id: string }>(admin, "/api/v1/projects", {
    key,
    name: `Triage ${key}`,
  });
  await created(admin, "/api/v1/projects", { key: other, name: `Triage ${other}` });
  await created(admin, `/api/v1/projects/${key}/tasks`, { title: "An ordinary task" });

  const triage = (await (await admin.request.get(`/api/v1/projects/${key}/triage`)).json()) as {
    version: number;
  };
  const patched = await admin.request.patch(`/api/v1/projects/${key}/triage`, {
    headers,
    data: { triageTeamId: triageTeam.id, rules: { api: apiTeam.id }, version: triage.version },
  });
  expect(patched.status()).toBe(200);

  const botName = `Triage bot ${id}`;
  const bot = await created<{ id: string }>(admin, "/api/v1/agents", {
    name: botName,
    role: "qa_agent",
    projectIds: [project.id],
  });
  const { token } = await created<{ token: string }>(admin, `/api/v1/agents/${bot.id}/tokens`, {
    name: "Triage flow",
  });
  const agent = await playwright.request.newContext({
    baseURL: E2E_BASE_URL,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });

  // 2. Two people with the board open.
  const member = await person(browser, "member", id);
  await openBoard(admin, key);
  await openBoard(member, key);
  const boards = [admin, member];
  let navigations = 0;
  for (const page of boards) {
    page.on("framenavigated", () => {
      navigations += 1;
    });
  }

  try {
    // a. A report: created, routed to the API team, first in the first column, live.
    const first = await file(agent, key, REPORT);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ outcome: "created", assignedTeamId: apiTeam.id });
    for (const page of boards) {
      const card = firstColumnCards(page).first();
      await expect(card).toContainText(REPORT.title);
      await expect(card).toContainText(apiTeam.name);
      await expect(card).toContainText("Severity: High");
      await expect(firstColumnCards(page)).toHaveCount(2);
    }

    // b. A repeat: deduplicated, counted on the same card, live.
    const repeat = await file(agent, key, { ...REPORT, runId: "run-2" });
    expect(repeat.status).toBe(200);
    expect(repeat.body).toEqual({
      outcome: "deduplicated",
      taskId: first.body.taskId,
      taskKey: first.body.taskKey,
      occurrences: 2,
    });
    for (const page of boards) {
      await expect(firstColumnCards(page).filter({ hasText: REPORT.title })).toHaveCount(1);
      await expect(firstColumnCards(page).first()).toContainText("2 reports");
    }

    // c. A layer the agent cannot tell goes to the triage team.
    const unknown = await file(agent, key, {
      title: "The page freezes",
      fingerprint: "unknown:/cart:freeze",
    });
    expect(unknown.status).toBe(201);
    expect(unknown.body).toMatchObject({ outcome: "created", assignedTeamId: triageTeam.id });
    for (const page of boards) {
      const card = firstColumnCards(page).first();
      await expect(card).toContainText("The page freezes");
      await expect(card).toContainText(triageTeam.name);
      await expect(firstColumnCards(page)).toHaveCount(3);
    }

    // d. A project outside the agent's restriction.
    expect((await file(agent, other, REPORT)).status).toBe(403);
    expect(navigations).toBe(0);

    // The detail of the first bug: what triage did.
    await admin.goto(`/projects/${key}/tasks/${String(first.body.taskKey)}`);
    await expect(admin.getByRole("region", { name: "Details" }).getByLabel("Severity")).toHaveValue(
      "high",
    );
    await expect(admin.getByText(/^Reported 2 times, last on /)).toBeVisible();
    const reports = admin.getByRole("region", { name: "Reports" });
    await expect(reports.getByRole("article")).toHaveCount(2);
    await expect(reports.getByRole("article").first()).toContainText(`${botName}Agent`);
    // The description, rendered by the server from the evidence (the Admin sees its editor).
    await expect(admin.getByRole("textbox", { name: "Description" })).toHaveValue(
      /### Steps to reproduce[\s\S]*Press Place order[\s\S]*### HTTP/,
    );
    const comments = admin.getByRole("region", { name: "Activity" });
    await expect(comments.getByRole("article")).toHaveCount(2);
    await expect(comments).toContainText(
      `Filed by ${botName} from a bug report: layer api, confidence 0.8, severity high. ` +
        `Assigned to ${apiTeam.name}.`,
    );
    await expect(comments).toContainText(`Reported again by ${botName} in run`);

    // The bug is closed; the same fingerprint again is a regression of it.
    const columns = (await (await admin.request.get(`/api/v1/projects/${key}/columns`)).json()) as {
      items: { id: string; category: string }[];
    };
    const done = columns.items.find((column) => column.category === "done");
    if (done === undefined) throw new Error("no done column");
    const bug = (await (
      await admin.request.get(`/api/v1/tasks/${String(first.body.taskKey)}`)
    ).json()) as { version: number };
    const moved = await admin.request.post(`/api/v1/tasks/${String(first.body.taskKey)}/move`, {
      headers,
      data: { columnId: done.id, version: bug.version },
    });
    expect(moved.status()).toBe(200);

    const regression = await file(agent, key, { ...REPORT, runId: "run-3" });
    expect(regression.status).toBe(201);
    expect(regression.body.taskKey).not.toBe(first.body.taskKey);
    await admin.goto(`/projects/${key}/tasks/${String(regression.body.taskKey)}`);
    const links = admin.getByRole("region", { name: "Links" });
    await expect(links.getByText("Regression of")).toBeVisible();
    await expect(
      links.getByRole("link", { name: `${String(first.body.taskKey)} ${REPORT.title}` }),
    ).toBeVisible();
  } finally {
    await agent.dispose();
  }
});
