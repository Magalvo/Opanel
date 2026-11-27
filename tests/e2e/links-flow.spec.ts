// The sub-tasks and links flow of WT-09 (WS-138 section 2): a Member makes a sub-task in the
// UI; a worker agent reads it and adds and removes links of each type across two projects
// through the API, and the Member's open page follows; a qa_agent and an agent restricted to
// one project are refused; the parent's progress reaches the agent.
import { type APIRequestContext, type Browser, type Page } from "@playwright/test";

import { expect, test } from "./base";
import { E2E_BASE_URL } from "./environment";
import { seedAccount } from "./seed";

const password = "an e2e links flow password, long enough";
const headers = { Origin: E2E_BASE_URL };

async function person(browser: Browser, role: "admin" | "member"): Promise<Page> {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL });
  const page = await context.newPage();
  const id = crypto.randomUUID().slice(0, 8);
  const email = `links-flow-${role}-${id}@example.com`;
  await seedAccount({ email, password, role, name: `Flow ${role} ${id}` });
  const response = await page.request.post("/api/v1/auth/sign-in", {
    headers,
    data: { email, password },
  });
  expect(response.status()).toBe(200);
  return page;
}

function newKey(): string {
  return `F${crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
}

/** A new agent of the Admin's, unrestricted when `projectIds` is null; answers its token. */
async function agentToken(
  admin: Page,
  name: string,
  role: "qa_agent" | "worker_agent",
  projectIds: string[] | null,
): Promise<string> {
  const made = await admin.request.post("/api/v1/agents", {
    headers,
    data: { name, role, projectIds },
  });
  expect(made.status()).toBe(201);
  const agentId = ((await made.json()) as { id: string }).id;
  const token = await admin.request.post(`/api/v1/agents/${agentId}/tokens`, {
    headers,
    data: { name: "Links flow" },
  });
  expect(token.status()).toBe(201);
  return ((await token.json()) as { token: string }).token;
}

interface TaskBody {
  version: number;
  parent: { key: string } | null;
  subtasks: { done: number; total: number } | null;
  links: { type: string; direction: string; task: { key: string } }[];
}

async function read(agent: APIRequestContext, key: string): Promise<TaskBody> {
  const response = await agent.get(`/api/v1/tasks/${key}`);
  expect(response.status(), key).toBe(200);
  return (await response.json()) as TaskBody;
}

function linkReadings(task: TaskBody): string[] {
  return task.links.map((link) => `${link.type} ${link.direction} ${link.task.key}`).sort();
}

test("a Member makes a sub-task; agents link across projects through the API, within their reach", async ({
  browser,
  playwright,
}) => {
  // 1. An Admin: projects A and B, their tasks, and three agents with tokens.
  const admin = await person(browser, "admin");
  const a = newKey();
  const b = newKey();
  const projectIds: Record<string, string> = {};
  for (const key of [a, b]) {
    const made = await admin.request.post("/api/v1/projects", {
      headers,
      data: { key, name: key },
    });
    expect(made.status()).toBe(201);
    projectIds[key] = ((await made.json()) as { id: string }).id;
  }
  for (const [key, title] of [
    [a, "Checkout"],
    [a, "Pay button"],
    [b, "Payments endpoint"],
  ] as const) {
    expect(
      (
        await admin.request.post(`/api/v1/projects/${key}/tasks`, { headers, data: { title } })
      ).status(),
    ).toBe(201);
  }
  const workerName = `Linker ${a}`;
  const tokens = {
    worker: await agentToken(admin, workerName, "worker_agent", null),
    restricted: await agentToken(admin, `Fenced ${a}`, "worker_agent", [projectIds[a] ?? ""]),
    qa: await agentToken(admin, `Tester ${a}`, "qa_agent", null),
  };
  await admin.context().close();
  const client = (token: string) =>
    playwright.request.newContext({
      baseURL: E2E_BASE_URL,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
  const worker = await client(tokens.worker);
  const restricted = await client(tokens.restricted);
  const qa = await client(tokens.qa);

  try {
    // 2. The Member, on Checkout's page, adds the sub-task "Card form".
    const member = await person(browser, "member");
    const stream = member.waitForResponse((response) => response.url().endsWith("/events"));
    await member.goto(`/projects/${a}/tasks/${a}-1`);
    expect((await stream).status()).toBe(200);
    const subtasks = member.getByRole("region", { name: "Sub-tasks" });
    await subtasks.getByRole("button", { name: "Add sub-task" }).click();
    const dialog = member.getByRole("dialog", { name: `Add a sub-task to ${a}-1` });
    await dialog.getByLabel("Title").fill("Card form");
    await dialog.getByRole("button", { name: "Add task" }).click();
    await expect(dialog).toBeHidden();
    await expect(subtasks.getByText("0 of 1 done")).toBeVisible();
    await member.evaluate(() => {
      (window as unknown as { notReloaded: boolean }).notReloaded = true;
    });

    // 3. The worker agent reads the sub-task, and links Checkout to B's task, each type once.
    expect((await read(worker, `${a}-3`)).parent?.key).toBe(`${a}-1`);
    const added = [
      { type: "blocks", direction: "outgoing" },
      { type: "duplicates", direction: "incoming" },
      { type: "regression_of", direction: "outgoing" },
      { type: "relates_to", direction: "outgoing" },
    ];
    for (const link of added) {
      const response = await worker.post(`/api/v1/tasks/${a}-1/links`, {
        data: { ...link, taskId: `${b}-1` },
      });
      expect(response.status(), link.type).toBe(200);
    }
    expect(linkReadings(await read(worker, `${b}-1`))).toEqual([
      `blocks incoming ${a}-1`,
      `duplicates outgoing ${a}-1`,
      `regression_of incoming ${a}-1`,
      `relates_to outgoing ${a}-1`,
    ]);
    expect(linkReadings(await read(worker, `${a}-1`))).toEqual([
      `blocks outgoing ${b}-1`,
      `duplicates incoming ${b}-1`,
      `regression_of outgoing ${b}-1`,
      `relates_to outgoing ${b}-1`,
    ]);

    // 4. The Member's open page shows the four, with no reload; the timeline names the agent.
    const links = member.getByRole("region", { name: "Links" });
    for (const group of ["Blocks", "Is duplicated by", "Regression of", "Relates to"]) {
      await expect(links.getByText(group, { exact: true })).toBeVisible();
    }
    const timeline = member.getByRole("region", { name: "Activity" });
    const line = timeline
      .getByRole("listitem")
      .filter({ hasText: `linked this task: blocks ${b}-1` });
    await expect(line).toContainText(workerName);
    await expect(line.getByText("Agent", { exact: true })).toBeVisible();

    // 5. The worker agent removes the duplicate; the page loses it.
    const removed = await worker.delete(
      `/api/v1/tasks/${a}-1/links?type=duplicates&direction=incoming&taskId=${b}-1`,
    );
    expect(removed.status()).toBe(204);
    await expect(links.getByText("Is duplicated by", { exact: true })).toBeHidden();
    await expect(links.getByText("Blocks", { exact: true })).toBeVisible();
    expect(
      await member.evaluate(() => (window as unknown as { notReloaded?: boolean }).notReloaded),
    ).toBe(true);

    // 6. A qa_agent has no tasks:write.
    expect(
      (
        await qa.post(`/api/v1/tasks/${a}-2/links`, {
          data: { type: "relates_to", direction: "outgoing", taskId: `${b}-1` },
        })
      ).status(),
    ).toBe(403);

    // 7. The restricted agent sees none of B in Checkout's links, cannot link to B, and
    // links within A.
    expect((await read(restricted, `${a}-1`)).links).toEqual([]);
    expect(
      (
        await restricted.post(`/api/v1/tasks/${a}-1/links`, {
          data: { type: "blocks", direction: "outgoing", taskId: `${b}-1` },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await restricted.post(`/api/v1/tasks/${a}-1/links`, {
          data: { type: "blocks", direction: "outgoing", taskId: `${a}-2` },
        })
      ).status(),
    ).toBe(200);

    // 8. The Member finishes the sub-task on the board; the agent reads the parent's progress.
    const board = await member.context().newPage();
    await board.goto(`/projects/${a}`);
    await board.getByRole("button", { name: `Actions for ${a}-3` }).click();
    await board.getByRole("menuitem", { name: "Done" }).click();
    await expect(board.getByLabel("1 of 1 sub-tasks done")).toBeVisible();
    expect((await read(worker, `${a}-1`)).subtasks).toEqual({ done: 1, total: 1 });
    await expect(subtasks.getByText("1 of 1 done")).toBeVisible();
  } finally {
    await Promise.all([worker.dispose(), restricted.dispose(), qa.dispose()]);
  }
});
