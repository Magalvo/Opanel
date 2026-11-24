// The timeline on the task page (WS-119 tests 9 and 10): changes made elsewhere, by a person
// or by an agent, appear on an open task page with no reload.
import { type Browser, type Page } from "@playwright/test";

import { expect, test } from "./base";
import { E2E_BASE_URL } from "./environment";
import { seedAccount } from "./seed";

const password = "an e2e timeline password, long enough";
const headers = { Origin: E2E_BASE_URL };

async function person(browser: Browser, role: "admin" | "member"): Promise<Page> {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL });
  const page = await context.newPage();
  const id = crypto.randomUUID().slice(0, 8);
  const email = `timeline-${role}-${id}@example.com`;
  await seedAccount({ email, password, role, name: `Timeline ${role} ${id}` });
  const response = await page.request.post("/api/v1/auth/sign-in", {
    headers,
    data: { email, password },
  });
  expect(response.status()).toBe(200);
  return page;
}

test("a change by someone else and an agent's change appear on an open task page", async ({
  browser,
  playwright,
}) => {
  const admin = await person(browser, "admin");
  const key = `T${crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
  expect(
    (await admin.request.post("/api/v1/projects", { headers, data: { key, name: key } })).status(),
  ).toBe(201);
  expect(
    (
      await admin.request.post(`/api/v1/projects/${key}/tasks`, {
        headers,
        data: { title: "Watch me" },
      })
    ).status(),
  ).toBe(201);
  const madeAgent = await admin.request.post("/api/v1/agents", {
    headers,
    data: { name: `Planner ${key}`, role: "worker_agent", projectIds: null },
  });
  expect(madeAgent.status()).toBe(201);
  const agentId = ((await madeAgent.json()) as { id: string }).id;
  const madeToken = await admin.request.post(`/api/v1/agents/${agentId}/tokens`, {
    headers,
    data: { name: "Timeline" },
  });
  const { token } = (await madeToken.json()) as { token: string };

  // The Member watches the task page.
  const member = await person(browser, "member");
  const stream = member.waitForResponse((response) => response.url().endsWith("/events"));
  await member.goto(`/projects/${key}/tasks/${key}-1`);
  expect((await stream).status()).toBe(200);
  const timeline = member.getByRole("region", { name: "Activity" });
  await expect(timeline.getByText(/created the task in To do/)).toBeVisible();
  await member.evaluate(() => {
    (window as unknown as { notReloaded: boolean }).notReloaded = true;
  });

  // The Admin changes the priority and moves the task.
  const read = async () =>
    (await (await admin.request.get(`/api/v1/tasks/${key}-1`)).json()) as { version: number };
  expect(
    (
      await admin.request.patch(`/api/v1/tasks/${key}-1`, {
        headers,
        data: { priority: "high", version: (await read()).version },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await admin.request.post(`/api/v1/tasks/${key}-1/move`, {
        headers,
        data: { columnId: null, version: (await read()).version },
      })
    ).status(),
  ).toBe(200);

  await expect(timeline.getByText(/changed the priority from None to High/)).toBeVisible();
  await expect(timeline.getByText(/moved it from To do to the backlog/)).toBeVisible();

  // An agent changes the due date; its line carries the Agent badge.
  const agent = await playwright.request.newContext({
    baseURL: E2E_BASE_URL,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
  try {
    const task = (await (await agent.get(`/api/v1/tasks/${key}-1`)).json()) as { version: number };
    expect(
      (
        await agent.patch(`/api/v1/tasks/${key}-1`, {
          data: { dueDate: "2030-06-10", version: task.version },
        })
      ).status(),
    ).toBe(200);
  } finally {
    await agent.dispose();
  }

  const line = timeline.getByRole("listitem").filter({ hasText: "set the due date" });
  await expect(line).toContainText(`Planner ${key}`);
  await expect(line.getByText("Agent", { exact: true })).toBeVisible();
  expect(
    await member.evaluate(() => (window as unknown as { notReloaded?: boolean }).notReloaded),
  ).toBe(true);
  await admin.context().close();
  await member.context().close();
});
