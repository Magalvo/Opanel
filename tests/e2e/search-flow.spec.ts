// The search flow of WT-08 (WS-131 section 2): an agent restricted to one project searches,
// filters and sorts through the API and changes a task; a Member finds the same work in the
// list view and reads its timeline; the agent reads the activity the Member added.
import { type APIRequestContext, type Browser, type Page } from "@playwright/test";

import { expect, test } from "./base";
import { E2E_BASE_URL } from "./environment";
import { seedAccount } from "./seed";

const password = "an e2e search flow password, long enough";
const headers = { Origin: E2E_BASE_URL };

async function person(browser: Browser, role: "admin" | "member"): Promise<Page> {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL });
  const page = await context.newPage();
  const id = crypto.randomUUID().slice(0, 8);
  const email = `search-${role}-${id}@example.com`;
  await seedAccount({ email, password, role, name: `Search ${role} ${id}` });
  const response = await page.request.post("/api/v1/auth/sign-in", {
    headers,
    data: { email, password },
  });
  expect(response.status()).toBe(200);
  return page;
}

function newKey(): string {
  return `S${crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
}

interface Item {
  key: string;
  title: string;
}

async function listKeys(agent: APIRequestContext, query: string): Promise<string[]> {
  const response = await agent.get(`/api/v1/tasks?${query}`);
  expect(response.status(), query).toBe(200);
  return ((await response.json()) as { items: Item[] }).items.map((item) => item.key);
}

function rowKeys(page: Page): Promise<string[]> {
  return page
    .getByRole("table", { name: "Tasks" })
    .getByRole("row")
    .locator("td:first-child")
    .allInnerTexts();
}

test("an agent restricted to one project searches through the API; a Member finds the same work in the list", async ({
  browser,
  playwright,
}) => {
  // 1. An Admin: projects A and B, their tasks, and a worker agent restricted to A.
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
    [a, "Login fails on Safari"],
    [a, "Logout button"],
    [a, "Release notes"],
    [b, "Login copy"],
  ] as const) {
    expect(
      (
        await admin.request.post(`/api/v1/projects/${key}/tasks`, { headers, data: { title } })
      ).status(),
    ).toBe(201);
  }
  const madeAgent = await admin.request.post("/api/v1/agents", {
    headers,
    data: { name: `Finder ${a}`, role: "worker_agent", projectIds: [projectIds[a]] },
  });
  expect(madeAgent.status()).toBe(201);
  const agentId = ((await madeAgent.json()) as { id: string }).id;
  const madeToken = await admin.request.post(`/api/v1/agents/${agentId}/tokens`, {
    headers,
    data: { name: "Search" },
  });
  expect(madeToken.status()).toBe(201);
  const { token } = (await madeToken.json()) as { token: string };
  await admin.context().close();

  const agent = await playwright.request.newContext({
    baseURL: E2E_BASE_URL,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
  try {
    // 2. The agent searches by words and by key, filters and sorts: A's tasks only.
    expect(await listKeys(agent, "q=log&sort=key")).toEqual([`${a}-1`, `${a}-2`]);
    expect(await listKeys(agent, `q=${a.toLowerCase()}-3`)).toEqual([`${a}-3`]);
    expect(await listKeys(agent, "type=task&sort=-key")).toEqual([`${a}-3`, `${a}-2`, `${a}-1`]);
    expect((await agent.get(`/api/v1/tasks?projectId=${b}`)).status()).toBe(403);

    // 3. The agent raises the priority of A-1 and comments on it.
    const task = (await (await agent.get(`/api/v1/tasks/${a}-1`)).json()) as { version: number };
    expect(
      (
        await agent.patch(`/api/v1/tasks/${a}-1`, {
          data: { priority: "high", version: task.version },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await agent.post(`/api/v1/tasks/${a}-1/comments`, {
          data: { body: "Seen again on Safari 18." },
        })
      ).status(),
    ).toBe(201);

    // 4. The Member, in the list view: "log" finds tasks of both projects; Project A and
    // Priority, descending, leave A's two, the high one first.
    const member = await person(browser, "member");
    await member.goto("/");
    await member
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Tasks" })
      .click();
    await expect(member).toHaveURL(/\/tasks$/);
    const bar = member.getByRole("search", { name: "Filter tasks" });
    await bar.getByLabel("Search tasks").fill("log");
    for (const key of [`${a}-1`, `${a}-2`, `${b}-1`]) {
      await expect(member.getByRole("link", { name: key, exact: true })).toBeVisible();
    }
    await bar.getByRole("button", { name: "Project", exact: true }).click();
    await member.getByRole("menuitemcheckbox", { name: a }).click();
    await member.keyboard.press("Escape");
    await member.getByRole("button", { name: "Sort by Priority" }).click();
    await member.getByRole("button", { name: "Sort by Priority" }).click();
    await expect.poll(() => rowKeys(member)).toEqual([`${a}-1`, `${a}-2`]);
    const url = new URL(member.url());
    expect(url.searchParams.get("q")).toBe("log");
    expect(url.searchParams.getAll("projectId")).toEqual([a]);
    expect(url.searchParams.get("sort")).toBe("-priority");

    // 5. Its timeline names the agent, with the Agent badge, and shows its comment.
    await member.getByRole("link", { name: `${a}-1`, exact: true }).click();
    await expect(member).toHaveURL(new RegExp(`/projects/${a}/tasks/${a}-1$`));
    const timeline = member.getByRole("region", { name: "Activity" });
    const line = timeline.getByRole("listitem").filter({ hasText: "changed the priority" });
    await expect(line).toContainText(`Finder ${a}`);
    await expect(line.getByText("Agent", { exact: true })).toBeVisible();
    await expect(timeline.getByText("Seen again on Safari 18.")).toBeVisible();

    // 6. The Member sets the due date.
    const details = member.getByRole("region", { name: "Details" });
    await details.getByLabel("Due date").fill("2030-06-10");
    await member.getByRole("button", { name: "Save changes" }).click();
    await expect(member.getByRole("status", { name: "Task messages" })).toHaveText("Saved.");

    // 7. The agent reads the activity: the last change is the Member's due date. B's task
    // is out of its reach.
    const activity = await agent.get(`/api/v1/tasks/${a}-1/activity?limit=100`);
    expect(activity.status()).toBe(200);
    const events = (
      (await activity.json()) as {
        items: {
          kind: string;
          field?: string | null;
          actor?: { name: string; kind: string } | null;
        }[];
      }
    ).items.filter((item) => item.kind === "event");
    const last = events.at(-1);
    expect(last?.field).toBe("dueDate");
    expect(last?.actor?.kind).toBe("human");
    expect(last?.actor?.name).toMatch(/^Search member /);
    expect((await agent.get(`/api/v1/tasks/${b}-1/activity`)).status()).toBe(403);
  } finally {
    await agent.dispose();
  }
});
