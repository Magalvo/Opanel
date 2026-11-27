// Links in the web app (WS-136 tests 8 and 9).
import { type Browser, type Page } from "@playwright/test";

import { expect, test } from "./base";
import { E2E_BASE_URL } from "./environment";
import { seedAccount } from "./seed";

const password = "an e2e links password, long enough";
const headers = { Origin: E2E_BASE_URL };

async function person(browser: Browser, role: "manager" | "member" | "viewer"): Promise<Page> {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL });
  const page = await context.newPage();
  const id = crypto.randomUUID().slice(0, 8);
  const email = `links-${role}-${id}@example.com`;
  await seedAccount({ email, password, role, name: `Link ${role} ${id}` });
  const response = await page.request.post("/api/v1/auth/sign-in", {
    headers,
    data: { email, password },
  });
  expect(response.status()).toBe(200);
  return page;
}

/** A project of the Manager's, with the given tasks; returns its key. */
async function project(manager: Page, titles: readonly string[]): Promise<string> {
  const key = `L${crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
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

function links(page: Page) {
  return page.getByRole("region", { name: "Links" });
}

test("a Member links tasks of two projects, the other page follows, and both timelines read it", async ({
  browser,
}) => {
  const manager = await person(browser, "manager");
  const word = crypto.randomUUID().slice(0, 6);
  const web = await project(manager, [`Checkout page ${word}`]);
  const api = await project(manager, [`Payments endpoint ${word}`]);
  const member = await person(browser, "member");

  // The API task's page, open from here on in a second tab.
  const other = await member.context().newPage();
  const stream = other.waitForResponse((response) => response.url().endsWith("/events"));
  await other.goto(`/projects/${api}/tasks/${api}-1`);
  expect((await stream).status()).toBe(200);
  await expect(links(other).getByText("No links yet.")).toBeVisible();
  await other.evaluate(() => {
    (window as unknown as { notReloaded: boolean }).notReloaded = true;
  });

  // The web task blocks the API task.
  await member.goto(`/projects/${web}/tasks/${web}-1`);
  await links(member).getByRole("button", { name: "Add link" }).click();
  const dialog = member.getByRole("dialog", { name: `Link ${web}-1 to another task` });
  await dialog.getByLabel("Link type").selectOption("Is blocked by");
  await dialog.getByLabel("Find a task").fill(`payments ${word}`);
  await dialog.getByRole("button", { name: `${api}-1 Payments endpoint ${word}` }).click();
  await expect(member.getByRole("status", { name: "Task messages" })).toHaveText("Link added.");
  await expect(links(member).getByText("Is blocked by")).toBeVisible();
  await expect(
    links(member).getByRole("link", { name: `${api}-1 Payments endpoint ${word}` }),
  ).toBeVisible();

  // The other page followed, with no reload, and removes it from there.
  await expect(links(other).getByText("Blocks", { exact: true })).toBeVisible();
  expect(
    await other.evaluate(() => (window as unknown as { notReloaded?: boolean }).notReloaded),
  ).toBe(true);
  await links(other)
    .getByRole("button", { name: `Remove link: blocks ${web}-1` })
    .click();
  await expect(other.getByRole("status", { name: "Task messages" })).toHaveText("Link removed.");
  await expect(links(other).getByText("No links yet.")).toBeVisible();
  await expect(links(member).getByText("No links yet.")).toBeVisible();

  for (const [page, sentence] of [
    [member, `linked this task: is blocked by ${api}-1`],
    [other, `removed the link: blocks ${web}-1`],
  ] as const) {
    await expect(
      page.getByRole("region", { name: "Activity" }).getByText(sentence, { exact: false }),
    ).toBeVisible();
  }
});

test("a Viewer reads a task's links and cannot change them", async ({ browser }) => {
  const manager = await person(browser, "manager");
  const key = await project(manager, ["Release 2.0", "Write the notes"]);
  expect(
    (
      await manager.request.post(`/api/v1/tasks/${key}-1/links`, {
        headers,
        data: { type: "relates_to", direction: "outgoing", taskId: `${key}-2` },
      })
    ).status(),
  ).toBe(200);
  const viewer = await person(browser, "viewer");

  await viewer.goto(`/projects/${key}/tasks/${key}-1`);
  await expect(links(viewer).getByText("Relates to")).toBeVisible();
  await expect(links(viewer).getByRole("link", { name: `${key}-2 Write the notes` })).toBeVisible();
  await expect(links(viewer).getByRole("button")).toHaveCount(0);
});
