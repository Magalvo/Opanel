// Labels in the UI (WS-108 test 11): a Member creates a label from the task's picker and
// applies it; a Manager renames it in the settings, and another open board follows live.
import { type Browser, type Page } from "@playwright/test";

import { expect, test } from "./base";
import { E2E_BASE_URL } from "./environment";
import { seedAccount } from "./seed";

const password = "an e2e labels password, long enough";
const headers = { Origin: E2E_BASE_URL };

async function person(browser: Browser, role: "manager" | "member"): Promise<Page> {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL });
  const page = await context.newPage();
  const id = crypto.randomUUID().slice(0, 8);
  const email = `labels-${role}-${id}@example.com`;
  await seedAccount({ email, password, role, name: `${role} ${id}` });
  const response = await page.request.post("/api/v1/auth/sign-in", {
    headers,
    data: { email, password },
  });
  expect(response.status()).toBe(200);
  return page;
}

async function openBoard(page: Page, key: string): Promise<void> {
  const stream = page.waitForResponse((response) => response.url().endsWith("/events"));
  await page.goto(`/projects/${key}`);
  expect((await stream).status()).toBe(200);
  await expect(page.getByRole("region", { name: "Board" })).toBeVisible();
}

test("a Member labels a task from the picker; a Manager renames the label, live", async ({
  browser,
}) => {
  const manager = await person(browser, "manager");
  const member = await person(browser, "member");
  const key = `G${crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
  expect(
    (
      await manager.request.post("/api/v1/projects", { headers, data: { key, name: key } })
    ).status(),
  ).toBe(201);
  expect(
    (
      await manager.request.post(`/api/v1/projects/${key}/tasks`, {
        headers,
        data: { title: "Write the docs" },
      })
    ).status(),
  ).toBe(201);

  // The Member creates a label from the picker and applies it.
  await member.goto(`/projects/${key}/tasks/${key}-1`);
  const labels = member.getByRole("group", { name: "Labels" });
  await labels.getByRole("button", { name: "Choose labels" }).click();
  await labels.getByLabel("Find or create a label").fill("Needs design");
  await labels.getByRole("button", { name: 'Create label "Needs design"' }).click();
  await expect(labels.getByRole("button", { name: "Remove label Needs design" })).toBeVisible();
  await member.getByRole("button", { name: "Save changes" }).click();
  await expect(member.getByRole("status", { name: "Task messages" })).toHaveText("Saved.");

  // The card shows it, on the Member's board.
  await openBoard(member, key);
  const chips = member.getByRole("list", { name: "Labels" });
  await expect(chips).toHaveText("Needs design");
  await member.evaluate(() => {
    (window as unknown as { notReloaded: boolean }).notReloaded = true;
  });

  // The Manager renames it in the settings; the Member's open board follows.
  await manager.goto(`/projects/${key}/settings`);
  await manager.getByRole("button", { name: "Edit Needs design" }).click();
  const dialog = manager.getByRole("dialog", { name: "Edit label" });
  await dialog.getByLabel("Name").fill("Design");
  await dialog.getByRole("radio", { name: "Purple" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(manager.getByRole("row", { name: /Design/ })).toBeVisible();

  await expect(chips).toHaveText("Design");
  expect(
    await member.evaluate(() => (window as unknown as { notReloaded?: boolean }).notReloaded),
  ).toBe(true);
});
