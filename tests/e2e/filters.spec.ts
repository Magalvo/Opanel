// The filter bar on the board and the backlog (WS-120 tests 8 to 10).
import { type Browser, type Page } from "@playwright/test";

import { expect, test } from "./base";
import { E2E_BASE_URL } from "./environment";
import { seedAccount } from "./seed";

const password = "an e2e filters password, long enough";
const headers = { Origin: E2E_BASE_URL };

async function person(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL });
  const page = await context.newPage();
  const id = crypto.randomUUID().slice(0, 8);
  const email = `filters-${id}@example.com`;
  await seedAccount({ email, password, role: "manager", name: `Filters ${id}` });
  const response = await page.request.post("/api/v1/auth/sign-in", {
    headers,
    data: { email, password },
  });
  expect(response.status()).toBe(200);
  return page;
}

/** A project with three board tasks and a label on one; returns its key and the label. */
async function project(page: Page): Promise<{ key: string; labelId: string }> {
  const key = `F${crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
  expect(
    (await page.request.post("/api/v1/projects", { headers, data: { key, name: key } })).status(),
  ).toBe(201);
  const label = await page.request.post(`/api/v1/projects/${key}/labels`, {
    headers,
    data: { name: "release", colour: "blue" },
  });
  const labelId = ((await label.json()) as { id: string }).id;
  for (const [title, labelIds] of [
    ["Login fails on Safari", [labelId]],
    ["Login page copy", []],
    ["Release notes", [labelId]],
  ] as const) {
    expect(
      (
        await page.request.post(`/api/v1/projects/${key}/tasks`, {
          headers,
          data: { title, labelIds },
        })
      ).status(),
    ).toBe(201);
  }
  return { key, labelId };
}

function titles(page: Page): Promise<string[]> {
  return page.getByRole("region", { name: "Board" }).locator("[data-title]").allInnerTexts();
}

test("a filtered board writes its filter to the URL, and the link shows the same cards", async ({
  browser,
}) => {
  const a = await person(browser);
  const { key, labelId } = await project(a);

  await a.goto(`/projects/${key}`);
  await expect.poll(() => titles(a)).toHaveLength(3);
  const bar = a.getByRole("search", { name: "Filter tasks" });
  await bar.getByRole("button", { name: "Label", exact: true }).click();
  await a.getByRole("menuitemcheckbox", { name: "release" }).click();
  await a.keyboard.press("Escape");
  await bar.getByLabel("Search tasks").fill("login");

  await expect.poll(() => titles(a)).toEqual(["Login fails on Safari"]);
  await expect(a).toHaveURL(new RegExp(`q=login`));
  expect(new URL(a.url()).searchParams.getAll("labelId")).toEqual([labelId]);
  await expect(bar.getByRole("status", { name: "Filter results" })).toHaveText(
    "1 of 3 tasks match.",
  );

  const b = await person(browser);
  await b.goto(a.url());
  await expect.poll(() => titles(b)).toEqual(["Login fails on Safari"]);
  await expect(b.getByRole("button", { name: "Remove Search: login" })).toBeVisible();
});

test("a filtered board follows changes made elsewhere, with no reload", async ({ browser }) => {
  const a = await person(browser);
  const { key } = await project(a);
  const stream = a.waitForResponse((response) => response.url().endsWith("/events"));
  await a.goto(`/projects/${key}?priority=high`);
  expect((await stream).status()).toBe(200);
  await expect(a.getByRole("region", { name: "Board" }).getByText("No matching tasks")).toHaveCount(
    3,
  );
  await a.evaluate(() => {
    (window as unknown as { notReloaded: boolean }).notReloaded = true;
  });

  const read = async (n: number) =>
    (await (await a.request.get(`/api/v1/tasks/${key}-${String(n)}`)).json()) as {
      version: number;
    };
  expect(
    (
      await a.request.patch(`/api/v1/tasks/${key}-2`, {
        headers,
        data: { priority: "high", version: (await read(2)).version },
      })
    ).status(),
  ).toBe(200);
  await expect.poll(() => titles(a)).toEqual(["Login page copy"]);

  expect(
    (
      await a.request.patch(`/api/v1/tasks/${key}-2`, {
        headers,
        data: { priority: "low", version: (await read(2)).version },
      })
    ).status(),
  ).toBe(200);
  await expect.poll(() => titles(a)).toEqual([]);
  expect(await a.evaluate(() => (window as unknown as { notReloaded?: boolean }).notReloaded)).toBe(
    true,
  );
});

test("opening a task from a filtered backlog and closing it keeps the filter", async ({
  browser,
}) => {
  const a = await person(browser);
  const key = `F${crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
  expect(
    (await a.request.post("/api/v1/projects", { headers, data: { key, name: key } })).status(),
  ).toBe(201);
  for (const [title, type] of [
    ["A bug in the backlog", "bug"],
    ["A story in the backlog", "story"],
  ] as const) {
    await a.request.post(`/api/v1/projects/${key}/tasks`, {
      headers,
      data: { title, type, columnId: null },
    });
  }

  await a.goto(`/projects/${key}/backlog?type=bug`);
  const backlog = a.getByRole("region", { name: "Backlog" });
  await expect(backlog.getByRole("link", { name: "A bug in the backlog" })).toBeVisible();
  await expect(backlog.getByText("A story in the backlog")).toBeHidden();
  await backlog.getByRole("link", { name: "A bug in the backlog" }).click();
  await expect(a.getByRole("dialog")).toBeVisible();
  await a.keyboard.press("Escape");

  await expect(a).toHaveURL(new RegExp(`/projects/${key}/backlog\\?type=bug$`));
  await expect(backlog.getByText("A story in the backlog")).toBeHidden();
});
