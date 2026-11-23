import type { Browser, Page } from "@playwright/test";

import { expect, test } from "./base";
import { E2E_BASE_URL } from "./environment";
import { seedAccount, taskHistory } from "./seed";

// Priority and due date in the UI (WS-110 tests 11 and 12). The browser's clock is fixed
// with `page.clock.setFixedTime`, which leaves timers running for the live stream.

const password = "an e2e priority and due date password";
const headers = { Origin: E2E_BASE_URL };

/** 2030-06-15, noon in UTC. */
const NOW = new Date("2030-06-15T12:00:00Z");

test.use({ timezoneId: "UTC" });

type Role = "manager" | "member";

/** Signs `page` in as a new account of `role`; returns its email. */
async function signInAs(page: Page, role: Role): Promise<string> {
  const email = `due-${role}-${crypto.randomUUID().slice(0, 8)}@example.com`;
  await seedAccount({ email, password, role, name: `Due ${role}` });
  const response = await page.request.post("/api/v1/auth/sign-in", {
    headers,
    data: { email, password },
  });
  expect(response.status()).toBe(200);
  return email;
}

interface Created {
  id: string;
  key: string;
  version: number;
}

/** A Manager in a page of its own creates a project and one task in its first column. */
async function projectWithTask(
  browser: Browser,
  data: Record<string, unknown>,
): Promise<{ key: string; task: Created }> {
  const manager = await browser.newPage({ baseURL: E2E_BASE_URL });
  try {
    await signInAs(manager, "manager");
    const key = `D${crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
    expect(
      (
        await manager.request.post("/api/v1/projects", { headers, data: { key, name: key } })
      ).status(),
    ).toBe(201);
    const created = await manager.request.post(`/api/v1/projects/${key}/tasks`, {
      headers,
      data,
    });
    expect(created.status()).toBe(201);
    return { key, task: (await created.json()) as Created };
  } finally {
    await manager.close();
  }
}

function details(page: Page) {
  return page.getByRole("region", { name: "Details" });
}

/** Saves the form and waits for the `PATCH`: "Saved." may still show from the last save. */
async function save(page: Page) {
  const saved = page.waitForResponse(
    (response) => response.request().method() === "PATCH" && response.status() === 200,
  );
  await details(page).getByRole("button", { name: "Save changes" }).click();
  await saved;
  await expect(page.getByRole("status", { name: "Task messages" })).toContainText("Saved.");
  await expect(details(page).getByRole("button", { name: "Save changes" })).toBeDisabled();
}

test("a Member sets and clears priority and due date; each change is one history entry; overdue shows outside done", async ({
  page,
  browser,
}) => {
  const { key, task } = await projectWithTask(browser, {
    title: "Ship the release",
  });
  const member = await signInAs(page, "member");
  await page.clock.setFixedTime(NOW);

  await page.goto(`/projects/${key}/tasks/${task.key}`);
  await details(page).getByLabel("Priority").selectOption({ label: "High" });
  await save(page);
  await details(page).getByLabel("Due date").fill("2030-06-10");
  await save(page);

  await page.goto(`/projects/${key}`);
  const card = page.getByRole("region", { name: /^To do/ }).getByRole("listitem");
  await expect(card.getByRole("img", { name: "Priority: High" })).toBeVisible();
  await expect(card).toContainText("Overdue, due Jun 10, 2030");

  await page.goto(`/projects/${key}/tasks/${task.key}`);
  await details(page).getByRole("button", { name: "Clear due date" }).click();
  await expect(details(page).getByLabel("Due date")).toHaveValue("");
  await save(page);
  await details(page).getByLabel("Priority").selectOption({ label: "None" });
  await save(page);

  expect(await taskHistory(task.id)).toEqual([
    { field: "priority", oldValue: "none", newValue: "high", actorEmail: member },
    { field: "dueDate", oldValue: null, newValue: "2030-06-10", actorEmail: member },
    { field: "dueDate", oldValue: "2030-06-10", newValue: null, actorEmail: member },
    { field: "priority", oldValue: "high", newValue: "none", actorEmail: member },
  ]);

  // The same past date in a done column is not overdue.
  await details(page).getByLabel("Due date").fill("2030-06-10");
  await save(page);
  await details(page).getByLabel("Column").selectOption({ label: "Done" });
  await expect(page.getByRole("status", { name: "Task messages" })).toContainText("Moved to Done.");
  await page.goto(`/projects/${key}`);
  const done = page.getByRole("region", { name: /^Done/ });
  await expect(done.getByRole("listitem")).toContainText("Due Jun 10, 2030");
  await expect(done).not.toContainText("Overdue");
});

test("overdue follows the viewer's own date: the same instant is a day later east of UTC", async ({
  browser,
}) => {
  const { key } = await projectWithTask(browser, {
    title: "Due on the fifteenth",
    dueDate: "2030-06-15",
  });

  // 11:00 UTC on June 15 is 01:00 on June 16 in Kiritimati (UTC+14).
  const instant = new Date("2030-06-15T11:00:00Z");
  for (const [timezoneId, text] of [
    ["Pacific/Kiritimati", "Overdue, due Jun 15, 2030"],
    ["UTC", "Due Jun 15, 2030"],
  ] as const) {
    const context = await browser.newContext({ baseURL: E2E_BASE_URL, timezoneId });
    try {
      const page = await context.newPage();
      await signInAs(page, "member");
      await page.clock.setFixedTime(instant);
      await page.goto(`/projects/${key}`);
      const card = page.getByRole("region", { name: /^To do/ }).getByRole("listitem");
      await expect(card, timezoneId).toContainText(text);
      if (timezoneId === "UTC") await expect(card).not.toContainText("Overdue");
    } finally {
      await context.close();
    }
  }
});
