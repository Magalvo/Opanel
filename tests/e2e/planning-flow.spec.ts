// The planning flow of WT-07 (WS-115 section 2): a Member plans in the UI, with the backlog,
// a priority, a due date and a label; an agent with a token reads and changes the same work
// through the API, within its scopes; the Member's open backlog follows live.
import { type Browser, type Page } from "@playwright/test";

import { expect, test } from "./base";
import { E2E_BASE_URL } from "./environment";
import { seedAccount, taskHistoryActors } from "./seed";

const password = "an e2e planning flow password, long enough";
const headers = { Origin: E2E_BASE_URL };

async function person(browser: Browser, role: "admin" | "member"): Promise<Page> {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL });
  const page = await context.newPage();
  const id = crypto.randomUUID().slice(0, 8);
  const email = `planning-${role}-${id}@example.com`;
  await seedAccount({ email, password, role, name: `Planning ${role} ${id}` });
  const response = await page.request.post("/api/v1/auth/sign-in", {
    headers,
    data: { email, password },
  });
  expect(response.status()).toBe(200);
  return page;
}

interface Task {
  id: string;
  key: string;
  title: string;
  version: number;
  columnId: string | null;
  priority: string;
  dueDate: string | null;
  labels: { id: string; name: string; colour: string }[];
}

function backlog(page: Page) {
  return page.getByRole("region", { name: "Backlog" });
}

async function titles(page: Page): Promise<string[]> {
  return backlog(page).getByRole("listitem").locator("[data-title]").allInnerTexts();
}

test("a Member plans in the UI; an agent reads and changes the plan through the API", async ({
  browser,
  playwright,
}) => {
  // 1. An Admin: the project, and a worker agent with its token.
  const admin = await person(browser, "admin");
  const key = `P${crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
  expect(
    (await admin.request.post("/api/v1/projects", { headers, data: { key, name: key } })).status(),
  ).toBe(201);
  const madeAgent = await admin.request.post("/api/v1/agents", {
    headers,
    data: { name: `Planner ${key}`, role: "worker_agent", projectIds: null },
  });
  expect(madeAgent.status()).toBe(201);
  const agentId = ((await madeAgent.json()) as { id: string }).id;
  const madeToken = await admin.request.post(`/api/v1/agents/${agentId}/tokens`, {
    headers,
    data: { name: "Planning" },
  });
  expect(madeToken.status()).toBe(201);
  const { token } = (await madeToken.json()) as { token: string };
  await admin.context().close();

  // 2. The Member, in the UI: two tasks in the backlog.
  const member = await person(browser, "member");
  const stream = member.waitForResponse((response) => response.url().endsWith("/events"));
  await member.goto(`/projects/${key}/backlog`);
  expect((await stream).status()).toBe(200);
  for (const title of ["Plan the release", "Write the notes"]) {
    await backlog(member).getByRole("button", { name: "Add task" }).click();
    const dialog = member.getByRole("dialog", { name: "Add a task to the backlog" });
    await dialog.getByLabel("Title").fill(title);
    await dialog.getByRole("button", { name: "Add task" }).click();
    await expect(dialog).toBeHidden();
  }
  await expect.poll(() => titles(member)).toEqual(["Plan the release", "Write the notes"]);

  // In the first task's detail, in a second tab: priority, due date and a new label.
  const detail = await member.context().newPage();
  await detail.goto(`/projects/${key}/tasks/${key}-1`);
  const details = detail.getByRole("region", { name: "Details" });
  await details.getByLabel("Priority").selectOption({ label: "High" });
  await details.getByLabel("Due date").fill("2030-06-10");
  const labels = detail.getByRole("group", { name: "Labels" });
  await labels.getByRole("button", { name: "Choose labels" }).click();
  await labels.getByLabel("Find or create a label").fill("release");
  await labels.getByRole("button", { name: 'Create label "release"' }).click();
  await expect(labels.getByRole("button", { name: "Remove label release" })).toBeVisible();
  await detail.getByRole("button", { name: "Save changes" }).click();
  await expect(detail.getByRole("status", { name: "Task messages" })).toHaveText("Saved.");
  await detail.close();

  // To the board, from the backlog page, which stays open from here on. The backlog shows
  // what the detail saved first, so its move sends the version it holds now (WS-128):
  // clicked earlier, the move is refused as a stale write.
  await expect(
    backlog(member)
      .getByRole("listitem")
      .filter({ hasText: "Plan the release" })
      .getByRole("img", { name: "Priority: High" }),
  ).toBeVisible();
  const sent = member.waitForResponse((response) => response.url().endsWith("/move"));
  await member.getByRole("button", { name: `Move to board ${key}-1` }).click();
  expect((await sent).status()).toBe(200);
  await expect.poll(() => titles(member)).toEqual(["Write the notes"]);
  await member.evaluate(() => {
    (window as unknown as { notReloaded: boolean }).notReloaded = true;
  });

  // 3. The agent, with its token alone: the task with its plan, and the backlog.
  const agent = await playwright.request.newContext({
    baseURL: E2E_BASE_URL,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
  try {
    const read = async (): Promise<Task> =>
      (await (await agent.get(`/api/v1/tasks/${key}-1`)).json()) as Task;
    const titlesThroughApi = async (): Promise<string[]> => {
      const response = await agent.get(`/api/v1/projects/${key}/backlog`);
      expect(response.status()).toBe(200);
      return ((await response.json()) as { items: Task[] }).items.map((task) => task.title);
    };

    const planned = await read();
    expect(planned).toMatchObject({ priority: "high", dueDate: "2030-06-10" });
    expect(planned.columnId).not.toBeNull();
    expect(planned.labels.map((label) => label.name)).toEqual(["release"]);
    expect(await titlesThroughApi()).toEqual(["Write the notes"]);

    // 4. It raises the priority; the history names the agent.
    const raised = await agent.patch(`/api/v1/tasks/${key}-1`, {
      data: { priority: "urgent", version: planned.version },
    });
    expect(raised.status()).toBe(200);
    expect((await taskHistoryActors(planned.id)).at(-1)).toEqual({
      field: "priority",
      newValue: "urgent",
      actorId: agentId,
    });

    // 5. It moves the task back to the backlog, at the end.
    const moved = await agent.post(`/api/v1/tasks/${key}-1/move`, {
      data: { columnId: null, version: ((await raised.json()) as Task).version },
    });
    expect(moved.status()).toBe(200);
    expect(await titlesThroughApi()).toEqual(["Write the notes", "Plan the release"]);

    // 6. It may not apply labels: 403, and the task keeps its label.
    const unlabel = await agent.patch(`/api/v1/tasks/${key}-1`, {
      data: { labelIds: [], version: (await read()).version },
    });
    expect(unlabel.status()).toBe(403);
    expect((await read()).labels.map((label) => label.name)).toEqual(["release"]);
  } finally {
    await agent.dispose();
  }

  // 7. The Member's open backlog followed, with no reload.
  await expect.poll(() => titles(member)).toEqual(["Write the notes", "Plan the release"]);
  await expect(
    backlog(member)
      .getByRole("listitem")
      .filter({ hasText: "Plan the release" })
      .getByRole("img", { name: "Priority: Urgent" }),
  ).toBeVisible();
  expect(
    await member.evaluate(() => (window as unknown as { notReloaded?: boolean }).notReloaded),
  ).toBe(true);
});
