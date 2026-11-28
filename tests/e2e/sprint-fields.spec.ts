import type { APIRequestContext, Browser, Page } from "@playwright/test";

import { expect, test } from "./base";
import { E2E_BASE_URL } from "./environment";
import { seedAccount } from "./seed";

// The task's sprint in the UI (WS-143 test 10): a Member puts a task in the active sprint
// from its page, reads it in the timeline, and finds it with the backlog's "Sprint" filter.

const password = "an e2e sprint fields password, long enough";
const headers = { Origin: E2E_BASE_URL };

type Role = "manager" | "member";

/** Signs `page` in as a new account of `role`. */
async function signInAs(page: Page, role: Role): Promise<void> {
  const email = `sprint-${role}-${crypto.randomUUID().slice(0, 8)}@example.com`;
  await seedAccount({ email, password, role, name: `Sprint ${role}` });
  const response = await page.request.post("/api/v1/auth/sign-in", {
    headers,
    data: { email, password },
  });
  expect(response.status()).toBe(200);
}

async function created<T>(
  request: APIRequestContext,
  path: string,
  data: Record<string, unknown>,
): Promise<T> {
  const response = await request.post(path, { headers, data });
  expect(response.status(), path).toBe(201);
  return (await response.json()) as T;
}

interface Versioned {
  id: string;
  key: string;
  version: number;
}

/**
 * A Manager makes a project with sprints, an active "Sprint 4", a planned "Sprint 5", and
 * two unscheduled tasks in the backlog.
 */
async function sprintProject(browser: Browser): Promise<{ key: string; task: Versioned }> {
  const manager = await browser.newPage({ baseURL: E2E_BASE_URL });
  try {
    await signInAs(manager, "manager");
    const { request } = manager;
    const key = `S${crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
    const project = await created<Versioned>(request, "/api/v1/projects", { key, name: key });
    const enabled = await request.patch(`/api/v1/projects/${key}`, {
      headers,
      data: { sprintsEnabled: true, version: project.version },
    });
    expect(enabled.status()).toBe(200);
    const active = await created<Versioned>(request, `/api/v1/projects/${key}/sprints`, {
      name: "Sprint 4",
      startDate: "2026-12-01",
      endDate: "2026-12-14",
    });
    await created<Versioned>(request, `/api/v1/projects/${key}/sprints`, {
      name: "Sprint 5",
      startDate: "2026-12-15",
      endDate: "2026-12-28",
    });
    const started = await request.post(`/api/v1/sprints/${active.id}/start`, {
      headers,
      data: { version: active.version },
    });
    expect(started.status()).toBe(200);
    const task = await created<Versioned>(request, `/api/v1/projects/${key}/tasks`, {
      title: "Plan the release",
    });
    await created<Versioned>(request, `/api/v1/projects/${key}/tasks`, { title: "Another task" });
    return { key, task };
  } finally {
    await manager.close();
  }
}

function details(page: Page) {
  return page.getByRole("region", { name: "Details" });
}

/** Chooses `option` in the task page's "Sprint" select and waits for the answer. */
async function chooseSprint(page: Page, option: string, said: string) {
  const answered = page.waitForResponse(
    (response) => response.request().method() === "PATCH" && response.status() === 200,
  );
  await details(page).getByRole("combobox", { name: "Sprint" }).selectOption({ label: option });
  await answered;
  await expect(page.getByRole("status", { name: "Task messages" })).toContainText(said);
}

test("a Member moves a task into the active sprint from its page, reads it in the timeline, and finds it with the backlog's Sprint filter", async ({
  page,
  browser,
}) => {
  const { key, task } = await sprintProject(browser);
  await signInAs(page, "member");

  await page.goto(`/projects/${key}/tasks/${task.key}`);
  const column = details(page).getByLabel("Column");
  await expect(column.locator("option:checked")).toHaveText("Backlog");

  await chooseSprint(page, "Sprint 4 (active)", "Moved to Sprint 4.");
  await expect(column.locator("option:checked")).toHaveText("To do");

  await chooseSprint(page, "Sprint 5 (planned)", "Moved to Sprint 5.");
  await expect(column.locator("option:checked")).toHaveText("Backlog");

  await page.reload();
  const timeline = page.getByRole("region", { name: "Activity" });
  await expect(timeline.getByText(/put it in the sprint Sprint 4/)).toBeVisible();
  await expect(timeline.getByText(/changed the sprint from Sprint 4 to Sprint 5/)).toBeVisible();

  await page.goto(`/projects/${key}/backlog`);
  // The backlog of a project with sprints has a section per sprint (WS-144).
  const backlog = page.getByRole("region", { name: "Backlog", exact: true });
  const sprint5 = page.getByRole("region", { name: "Sprint 5", exact: true });
  await expect(backlog.getByText("Another task")).toBeVisible();
  await page.getByRole("button", { name: "Sprint", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "Sprint 5 (planned)" }).click();
  await page.keyboard.press("Escape");

  await expect(page).toHaveURL(/sprintId=/);
  await expect(backlog.getByText("Another task")).toBeHidden();
  await expect(sprint5.getByText("Plan the release")).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Sprint: Sprint 5" })).toBeVisible();
});
