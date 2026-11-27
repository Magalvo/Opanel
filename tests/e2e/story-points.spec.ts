import type { Browser, Page } from "@playwright/test";

import { expect, test } from "./base";
import { E2E_BASE_URL } from "./environment";
import { seedAccount, taskHistory } from "./seed";

// Story points in the UI (WS-139 test 15): set on the task page, seen on the card, in the
// epic and in the timeline.

const password = "an e2e story points password, long enough";
const headers = { Origin: E2E_BASE_URL };

type Role = "manager" | "member";

/** Signs `page` in as a new account of `role`; returns its email. */
async function signInAs(page: Page, role: Role): Promise<string> {
  const email = `points-${role}-${crypto.randomUUID().slice(0, 8)}@example.com`;
  await seedAccount({ email, password, role, name: `Points ${role}` });
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
}

/** A Manager creates a project, an epic "Launch", and two tasks in it, one with 5 points. */
async function projectWithEpic(browser: Browser): Promise<{ key: string; task: Created }> {
  const manager = await browser.newPage({ baseURL: E2E_BASE_URL });
  try {
    await signInAs(manager, "manager");
    const key = `P${crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
    expect(
      (
        await manager.request.post("/api/v1/projects", { headers, data: { key, name: key } })
      ).status(),
    ).toBe(201);
    const epic = await manager.request.post(`/api/v1/projects/${key}/epics`, {
      headers,
      data: { title: "Launch" },
    });
    expect(epic.status()).toBe(201);
    const epicId = ((await epic.json()) as { id: string }).id;
    const created = await manager.request.post(`/api/v1/projects/${key}/tasks`, {
      headers,
      data: { title: "Estimate me", epicId },
    });
    expect(created.status()).toBe(201);
    const other = await manager.request.post(`/api/v1/projects/${key}/tasks`, {
      headers,
      data: { title: "Already estimated", epicId, storyPoints: 5 },
    });
    expect(other.status()).toBe(201);
    return { key, task: (await created.json()) as Created };
  } finally {
    await manager.close();
  }
}

function details(page: Page) {
  return page.getByRole("region", { name: "Details" });
}

async function save(page: Page) {
  const saved = page.waitForResponse(
    (response) => response.request().method() === "PATCH" && response.status() === 200,
  );
  await details(page).getByRole("button", { name: "Save changes" }).click();
  await saved;
  await expect(page.getByRole("status", { name: "Task messages" })).toContainText("Saved.");
  await expect(details(page).getByRole("button", { name: "Save changes" })).toBeDisabled();
}

test("a Member sets story points on a task page, and sees them on the card, in the epic and in the timeline", async ({
  page,
  browser,
}) => {
  const { key, task } = await projectWithEpic(browser);
  const member = await signInAs(page, "member");

  await page.goto(`/projects/${key}/tasks/${task.key}`);
  await details(page).getByLabel("Story points").fill("3");
  await save(page);
  await details(page).getByLabel("Story points").fill("8");
  await save(page);

  const timeline = page.getByRole("region", { name: "Activity" });
  await expect(timeline.getByText(/changed the story points from none to 3/)).toBeVisible();
  await expect(timeline.getByText(/changed the story points from 3 to 8/)).toBeVisible();
  expect(await taskHistory(task.id)).toEqual([
    { field: "storyPoints", oldValue: null, newValue: 3, actorEmail: member },
    { field: "storyPoints", oldValue: 3, newValue: 8, actorEmail: member },
  ]);

  await page.goto(`/projects/${key}`);
  const card = page
    .getByRole("region", { name: /^To do/ })
    .getByRole("listitem")
    .filter({ hasText: "Estimate me" });
  await expect(card.getByLabel("8 story points")).toHaveText("8");

  await page.goto(`/projects/${key}/epics`);
  const row = page.getByRole("row", { name: /Launch/ });
  await expect(row.getByLabel("0 of 13 story points done")).toHaveText("0 / 13 points");
  await expect(row).not.toContainText("not estimated");
});
