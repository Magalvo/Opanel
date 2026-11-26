// The list view of tasks (WS-130 tests 9 to 11).
import { type Browser, type Page } from "@playwright/test";

import { expect, test } from "./base";
import { E2E_BASE_URL } from "./environment";
import { seedAccount } from "./seed";

const password = "an e2e task list password, long enough";
const headers = { Origin: E2E_BASE_URL };

async function person(browser: Browser, role: "manager" | "member"): Promise<Page> {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL });
  const page = await context.newPage();
  const id = crypto.randomUUID().slice(0, 8);
  const email = `task-list-${id}@example.com`;
  await seedAccount({ email, password, role, name: `List ${id}` });
  const response = await page.request.post("/api/v1/auth/sign-in", {
    headers,
    data: { email, password },
  });
  expect(response.status()).toBe(200);
  return page;
}

/** A project with the given tasks, each `[title, extra fields]`; returns its key. */
async function project(
  page: Page,
  tasks: readonly (readonly [string, Record<string, unknown>])[],
): Promise<string> {
  const key = `L${crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
  expect(
    (await page.request.post("/api/v1/projects", { headers, data: { key, name: key } })).status(),
  ).toBe(201);
  for (const [title, extra] of tasks) {
    expect(
      (
        await page.request.post(`/api/v1/projects/${key}/tasks`, {
          headers,
          data: { title, ...extra },
        })
      ).status(),
    ).toBe(201);
  }
  return key;
}

function keys(page: Page): Promise<string[]> {
  return page
    .getByRole("table", { name: "Tasks" })
    .getByRole("row")
    .locator("td:first-child")
    .allInnerTexts();
}

test("a Member lists tasks across projects, a project's List shows only its own, and a key opens the task", async ({
  browser,
}) => {
  const manager = await person(browser, "manager");
  const first = await project(manager, [
    ["Board task", {}],
    ["Backlog task", { columnId: null }],
  ]);
  const second = await project(manager, [["Other project task", {}]]);

  const member = await person(browser, "member");
  await member.goto("/");
  await member
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Tasks" })
    .click();
  await expect(member).toHaveURL(/\/tasks$/);
  await expect(member.getByRole("table", { name: "Tasks" })).toBeVisible();

  await member.goto(`/tasks?projectId=${first}&projectId=${second}&sort=key`);
  await expect.poll(() => keys(member)).toEqual([`${first}-1`, `${first}-2`, `${second}-1`].sort());
  const backlogRow = member.getByRole("row").filter({ hasText: "Backlog task" });
  await expect(backlogRow.getByRole("cell").nth(3)).toHaveText("Backlog");

  await member.goto(`/projects/${second}`);
  await member
    .getByRole("navigation", { name: "Project" })
    .getByRole("link", { name: "List" })
    .click();
  await expect(member).toHaveURL(new RegExp(`/tasks\\?projectId=${second}$`));
  await expect.poll(() => keys(member)).toEqual([`${second}-1`]);

  await member.getByRole("link", { name: `${second}-1`, exact: true }).click();
  await expect(member).toHaveURL(new RegExp(`/projects/${second}/tasks/${second}-1$`));
  await expect(member.getByRole("heading", { name: "Other project task" })).toBeVisible();
  await member.goBack();
  await expect(member).toHaveURL(new RegExp(`/tasks\\?projectId=${second}$`));
  await expect.poll(() => keys(member)).toEqual([`${second}-1`]);
});

test("a filtered and sorted list is in the URL, and the link shows the same rows", async ({
  browser,
}) => {
  const a = await person(browser, "manager");
  const key = await project(a, []);
  const label = await a.request.post(`/api/v1/projects/${key}/labels`, {
    headers,
    data: { name: "release", colour: "blue" },
  });
  const labelId = ((await label.json()) as { id: string }).id;
  for (const [title, priority, labelIds] of [
    ["Low and released", "low", [labelId]],
    ["Urgent and released", "urgent", [labelId]],
    ["Urgent, no label", "urgent", []],
    ["High and released", "high", [labelId]],
  ] as const) {
    expect(
      (
        await a.request.post(`/api/v1/projects/${key}/tasks`, {
          headers,
          data: { title, priority, labelIds },
        })
      ).status(),
    ).toBe(201);
  }

  await a.goto("/tasks");
  const bar = a.getByRole("search", { name: "Filter tasks" });
  await bar.getByRole("button", { name: "Project", exact: true }).click();
  await a.getByRole("menuitemcheckbox", { name: key }).click();
  await a.keyboard.press("Escape");
  await expect(a).toHaveURL(new RegExp(`projectId=${key}`));
  await bar.getByRole("button", { name: "Label", exact: true }).click();
  await a.getByRole("menuitemcheckbox", { name: "release" }).click();
  await a.keyboard.press("Escape");
  await a.getByRole("button", { name: "Sort by Priority" }).click();
  await a.getByRole("button", { name: "Sort by Priority" }).click();

  await expect.poll(() => keys(a)).toEqual([`${key}-2`, `${key}-4`, `${key}-1`]);
  const url = new URL(a.url());
  expect(url.searchParams.getAll("projectId")).toEqual([key]);
  expect(url.searchParams.getAll("labelId")).toEqual([labelId]);
  expect(url.searchParams.get("sort")).toBe("-priority");
  await expect(a.getByRole("columnheader").filter({ hasText: "Priority" })).toHaveAttribute(
    "aria-sort",
    "descending",
  );

  const b = await person(browser, "member");
  await b.goto(a.url());
  await expect.poll(() => keys(b)).toEqual([`${key}-2`, `${key}-4`, `${key}-1`]);
  await expect(b.getByRole("button", { name: "Remove Label: release" })).toBeVisible();
});

test("the list is not live: a change made elsewhere shows after Refresh", async ({ browser }) => {
  const a = await person(browser, "manager");
  const key = await project(a, [["Before the change", {}]]);

  await a.goto(`/tasks?projectId=${key}`);
  await expect(a.getByRole("row").filter({ hasText: "Before the change" })).toBeVisible();

  const task = (await (await a.request.get(`/api/v1/tasks/${key}-1`)).json()) as {
    version: number;
  };
  expect(
    (
      await a.request.patch(`/api/v1/tasks/${key}-1`, {
        headers,
        data: { title: "After the change", version: task.version },
      })
    ).status(),
  ).toBe(200);
  // Long enough for a live page to have shown it (the filtered board refreshes within 1 s).
  await a.waitForTimeout(2_000);
  await expect(a.getByRole("row").filter({ hasText: "Before the change" })).toBeVisible();

  await a.getByRole("button", { name: "Refresh" }).click();
  await expect(a.getByRole("row").filter({ hasText: "After the change" })).toBeVisible();
});
