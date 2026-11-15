import AxeBuilder from "@axe-core/playwright";
import { type APIRequestContext, type Browser, type Page } from "@playwright/test";

import { expect, test as base } from "./base";
import { E2E_BASE_URL } from "./environment";
import { seedAccount } from "./seed";

const password = "an e2e epics password, long";

async function signIn(request: APIRequestContext, email: string) {
  const response = await request.post("/api/v1/auth/sign-in", {
    headers: { Origin: E2E_BASE_URL },
    data: { email, password },
  });
  expect(response.status()).toBe(200);
}

async function send(
  request: APIRequestContext,
  method: "post" | "patch",
  path: string,
  data?: unknown,
) {
  const response = await request[method](path, {
    headers: { Origin: E2E_BASE_URL },
    ...(data === undefined ? {} : { data }),
  });
  expect(response.status(), path).toBeLessThan(300);
  return (await response.json()) as {
    id: string;
    version: number;
    items?: { id: string; category?: string }[];
  };
}

/** A key no other test of the run uses: the end-to-end database keeps every project. */
function newKey(): string {
  return `P${String(Date.now()).slice(-7)}${String(Math.floor(Math.random() * 10))}`;
}

async function managerContext(browser: Browser) {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL });
  const email = `manager-${crypto.randomUUID()}@example.com`;
  await seedAccount({ email, password, role: "manager" });
  await signIn(context.request, email);
  return context;
}

function as(role: "manager" | "member") {
  return base.extend({
    page: async ({ page }, provide) => {
      const email = `${role}-${crypto.randomUUID()}@example.com`;
      await seedAccount({ email, password, role });
      await signIn(page.request, email);
      await provide(page);
    },
  });
}

const manager = as("manager");
const member = as("member");

function epicRow(page: Page, title: string) {
  return page.getByRole("row", { name: new RegExp(title) });
}

manager(
  "a Manager creates an epic, sees its progress follow its tasks, and closes and reopens it",
  async ({ page }) => {
    const key = newKey();
    await send(page.request, "post", "/api/v1/projects", { key, name: "Epics project" });
    await page.goto(`/projects/${key}`);
    await page.getByRole("link", { name: "Epics" }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${key}/epics$`));

    await page.getByRole("button", { name: "New epic" }).click();
    const create = page.getByRole("dialog", { name: "New epic" });
    await create.getByLabel("Title").fill("Billing");
    await create.getByRole("textbox", { name: "Description" }).fill("Invoices and **receipts**");
    await create.getByLabel("Start date").fill("2026-11-20");
    await create.getByLabel("Target date").fill("2026-12-31");
    await create.getByRole("button", { name: "Create epic" }).click();
    await expect(page.getByRole("status", { name: "Epic messages" })).toContainText(
      "Created Billing.",
    );
    await expect(epicRow(page, "Billing").getByText("No tasks")).toBeVisible();

    // Two tasks in the epic, made through the API; one is moved to a Done column.
    const epics = (await (await page.request.get(`/api/v1/projects/${key}/epics`)).json()) as {
      items: { id: string; title: string }[];
    };
    const epicId = epics.items.find((item) => item.title === "Billing")?.id;
    const first = await send(page.request, "post", `/api/v1/projects/${key}/tasks`, {
      title: "A",
      epicId,
    });
    await send(page.request, "post", `/api/v1/projects/${key}/tasks`, { title: "B", epicId });
    const columns = (await (await page.request.get(`/api/v1/projects/${key}/columns`)).json()) as {
      items: { id: string; category: string }[];
    };
    const done = columns.items.find((column) => column.category === "done");
    await send(page.request, "post", `/api/v1/tasks/${first.id}/move`, {
      columnId: done?.id,
      version: 1,
    });

    await page.reload();
    await expect(
      epicRow(page, "Billing").getByRole("progressbar", {
        name: "Progress of Billing: 1 of 2 tasks done",
      }),
    ).toBeVisible();

    await epicRow(page, "Billing").getByRole("button", { name: "Billing" }).click();
    const dialog = page.getByRole("dialog", { name: "Epic Billing" });
    await dialog.getByLabel("Title").fill("Billing v2");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog.getByRole("status", { name: "Epic dialog messages" })).toContainText(
      "Saved the epic.",
    );

    await dialog.getByRole("button", { name: "Close epic" }).click();
    await expect(page.getByRole("alertdialog")).toContainText("1 task that is not done");
    await page.getByRole("alertdialog").getByRole("button", { name: "Close epic" }).click();
    await expect(page.getByRole("status", { name: "Epic messages" })).toContainText(
      "Closed Billing v2.",
    );
    await expect(epicRow(page, "Billing v2")).toHaveCount(0);

    await page.getByRole("combobox", { name: "Show" }).click();
    await page.getByRole("option", { name: "Closed" }).click();
    await epicRow(page, "Billing v2").getByRole("button", { name: "Billing v2" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reopen epic" }).click();
    await expect(page.getByRole("status", { name: "Epic messages" })).toContainText(
      "Reopened Billing v2.",
    );
  },
);

member(
  "a Member opens the epics from the project, reads a description, sees no controls, and finds a closed epic only under Closed",
  async ({ page, browser }) => {
    const key = newKey();
    const context = await managerContext(browser);
    try {
      await send(context.request, "post", "/api/v1/projects", { key, name: "Seen epics" });
      await send(context.request, "post", `/api/v1/projects/${key}/epics`, {
        title: "Open one",
        description: "Some **bold** words",
      });
      const closed = await send(context.request, "post", `/api/v1/projects/${key}/epics`, {
        title: "Closed one",
      });
      await send(context.request, "patch", `/api/v1/epics/${closed.id}`, {
        status: "closed",
        version: 1,
      });
    } finally {
      await context.close();
    }

    await page.goto(`/projects/${key}`);
    await page.getByRole("link", { name: "Epics" }).click();
    await expect(epicRow(page, "Open one")).toBeVisible();
    await expect(epicRow(page, "Closed one")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New epic" })).toHaveCount(0);

    await epicRow(page, "Open one").getByRole("button", { name: "Open one" }).click();
    const dialog = page.getByRole("dialog", { name: "Epic Open one" });
    await expect(dialog.locator("strong", { hasText: "bold" })).toBeVisible();
    await expect(dialog.getByRole("textbox")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Close epic" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.getByRole("combobox", { name: "Show" }).click();
    await page.getByRole("option", { name: "Closed" }).click();
    await expect(epicRow(page, "Closed one")).toBeVisible();
  },
);

for (const colorScheme of ["light", "dark"] as const) {
  manager(
    `the page and its dialog fit a phone and have no accessibility violations in ${colorScheme} mode`,
    async ({ page }) => {
      const key = newKey();
      await send(page.request, "post", "/api/v1/projects", { key, name: "Phone epics" });
      await send(page.request, "post", `/api/v1/projects/${key}/epics`, {
        title: "Phone epic",
        description: "Text",
      });
      await page.setViewportSize({ width: 390, height: 800 });
      await page.emulateMedia({ colorScheme });
      await page.goto(`/projects/${key}/epics`);
      await expect(page.getByRole("heading", { level: 1, name: "Epics" })).toBeVisible();
      await expect(page.getByRole("table")).toBeVisible();

      for (const open of [
        () => Promise.resolve(),
        async () => {
          await page.getByRole("button", { name: "Phone epic" }).click();
          await expect(page.getByRole("dialog", { name: "Epic Phone epic" })).toBeVisible();
        },
      ]) {
        await open();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze();
        expect(results.violations.map((violation) => violation.id)).toEqual([]);
      }
    },
  );
}
