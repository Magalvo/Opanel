// Sub-tasks in the web app (WS-135 tests 10 and 11).
import { type Browser, type Page } from "@playwright/test";

import { expect, test } from "./base";
import { E2E_BASE_URL } from "./environment";
import { seedAccount } from "./seed";

const password = "an e2e sub-tasks password, long enough";
const headers = { Origin: E2E_BASE_URL };

async function person(browser: Browser, role: "manager" | "member"): Promise<Page> {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL });
  const page = await context.newPage();
  const id = crypto.randomUUID().slice(0, 8);
  const email = `subtasks-${role}-${id}@example.com`;
  await seedAccount({ email, password, role, name: `Sub ${role} ${id}` });
  const response = await page.request.post("/api/v1/auth/sign-in", {
    headers,
    data: { email, password },
  });
  expect(response.status()).toBe(200);
  return page;
}

/** A project of the Manager's, with the given tasks; returns its key. */
async function project(manager: Page, titles: readonly string[]): Promise<string> {
  const key = `S${crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
  expect(
    (
      await manager.request.post("/api/v1/projects", { headers, data: { key, name: key } })
    ).status(),
  ).toBe(201);
  for (const title of titles) {
    expect(
      (
        await manager.request.post(`/api/v1/projects/${key}/tasks`, { headers, data: { title } })
      ).status(),
    ).toBe(201);
  }
  return key;
}

function subtasks(page: Page) {
  return page.getByRole("region", { name: "Sub-tasks" });
}

test("a Member adds sub-tasks from a page, and a move on the board reaches the open parent page", async ({
  browser,
}) => {
  const manager = await person(browser, "manager");
  const key = await project(manager, ["Release 2.0"]);
  const member = await person(browser, "member");

  // The parent's page, open from here on.
  const stream = member.waitForResponse((response) => response.url().endsWith("/events"));
  await member.goto(`/projects/${key}/tasks/${key}-1`);
  expect((await stream).status()).toBe(200);
  for (const title of ["Write the notes", "Tag the build"]) {
    await subtasks(member).getByRole("button", { name: "Add sub-task" }).click();
    const dialog = member.getByRole("dialog", { name: `Add a sub-task to ${key}-1` });
    await dialog.getByLabel("Title").fill(title);
    await dialog.getByRole("button", { name: "Add task" }).click();
    await expect(dialog).toBeHidden();
  }
  await expect(subtasks(member).getByText("0 of 2 done")).toBeVisible();
  await member.evaluate(() => {
    (window as unknown as { notReloaded: boolean }).notReloaded = true;
  });

  // The board, in a second tab: the marks, then a move of the first sub-task to Done.
  const board = await member.context().newPage();
  await board.goto(`/projects/${key}`);
  await expect(board.getByLabel("0 of 2 sub-tasks done")).toBeVisible();
  await expect(board.getByLabel(`Sub-task of ${key}-1`)).toHaveCount(2);
  await board.getByRole("button", { name: `Actions for ${key}-2` }).click();
  await board.getByRole("menuitem", { name: "Done" }).click();
  await expect(board.getByLabel("1 of 2 sub-tasks done")).toBeVisible();

  // The parent's page followed, with no reload.
  await expect(subtasks(member).getByText("1 of 2 done")).toBeVisible();
  await expect(
    subtasks(member).getByRole("listitem").filter({ hasText: "Write the notes" }),
  ).toContainText("Done");
  expect(
    await member.evaluate(() => (window as unknown as { notReloaded?: boolean }).notReloaded),
  ).toBe(true);
});

test("a Member sets a parent by searching, sees the card's mark, removes it, and reads both in the timeline", async ({
  browser,
}) => {
  const manager = await person(browser, "manager");
  const key = await project(manager, ["Release 2.0", "Write the notes"]);
  const member = await person(browser, "member");

  await member.goto(`/projects/${key}/tasks/${key}-2`);
  const details = member.getByRole("region", { name: "Details" });
  await details.getByRole("button", { name: "Set parent" }).click();
  const dialog = member.getByRole("dialog", { name: `Set a parent for ${key}-2` });
  await dialog.getByLabel("Find a task").fill("release");
  await dialog.getByRole("button", { name: `${key}-1 Release 2.0` }).click();
  await expect(member.getByRole("status", { name: "Task messages" })).toHaveText(
    `Now a sub-task of ${key}-1.`,
  );
  await expect(details.getByRole("link", { name: new RegExp(`${key}-1`) })).toBeVisible();

  const board = await member.context().newPage();
  await board.goto(`/projects/${key}`);
  await expect(board.getByLabel(`Sub-task of ${key}-1`)).toHaveCount(1);
  await expect(board.getByLabel("0 of 1 sub-tasks done")).toBeVisible();
  await board.close();

  await details.getByRole("button", { name: "Remove parent" }).click();
  await expect(member.getByRole("status", { name: "Task messages" })).toHaveText("Parent removed.");
  const timeline = member.getByRole("region", { name: "Activity" });
  await expect(timeline.getByText(`made it a sub-task of ${key}-1`)).toBeVisible();
  await expect(timeline.getByText(`removed it from ${key}-1`)).toBeVisible();
});
