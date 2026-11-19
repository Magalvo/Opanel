import type { Page } from "@playwright/test";

import { expect, test as base } from "./base";
import { E2E_BASE_URL } from "./environment";
import { seedAccount } from "./seed";

// The Agents page end to end (WS-077 tests 7, 8 and 10): what an Admin does there, and
// that the token they get works on the API exactly as configured.

const password = "an e2e agents password, long enough";
const headers = { Origin: E2E_BASE_URL };

const admin = base.extend({
  page: async ({ page }, provide) => {
    const email = `agents-admin-${crypto.randomUUID()}@example.com`;
    await seedAccount({ email, password, role: "admin" });
    const response = await page.request.post("/api/v1/auth/sign-in", {
      headers,
      data: { email, password },
    });
    expect(response.status()).toBe(200);
    await provide(page);
  },
});

function suffix(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase();
}

async function createProject(page: Page, key: string): Promise<void> {
  const response = await page.request.post("/api/v1/projects", {
    headers,
    data: { key, name: `Agents ${key}` },
  });
  expect(response.status()).toBe(201);
}

/** A request as the agent sends it: its token decides, the browser's cookie is ignored. */
function asAgent(page: Page, token: string, path: string) {
  return page.request.get(path, { headers: { Authorization: `Bearer ${token}` } });
}

async function createTokenInUi(page: Page, name: string): Promise<string> {
  await page.getByRole("button", { name: "Create token" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Token name").fill(name);
  await expect(dialog.getByRole("radio", { name: "90 days" })).toBeChecked();
  await dialog.getByRole("button", { name: "Create token" }).click();
  const field = dialog.getByLabel("Token", { exact: true });
  await expect(field).toHaveValue(/^opk_[a-z2-7]{12}_[0-9a-f]{64}$/);
  await expect(dialog.getByText(/will not be shown again/)).toBeVisible();
  const token = await field.inputValue();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
  return token;
}

admin(
  "an Admin creates a restricted agent and a token that reaches only its project, then revokes it",
  async ({ page }) => {
    const id = suffix();
    const [allowed, other] = [`A${id}`, `O${id}`];
    await createProject(page, allowed);
    await createProject(page, other);

    await page.goto("/agents");
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Agents" })
      .waitFor();
    await page.getByRole("button", { name: "New agent" }).click();
    const form = page.getByRole("dialog");
    await form.getByLabel("Name").fill(`Scoped bot ${id}`);
    await form.getByRole("radio", { name: "Only these projects" }).check();
    await form.getByRole("checkbox", { name: `Agents ${allowed}` }).click();
    await form.getByRole("button", { name: "Create agent" }).click();

    await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: new RegExp(`Scoped bot ${id}`) })).toBeVisible();
    await expect(page.getByText(`Agents ${allowed}`)).toBeVisible();

    const token = await createTokenInUi(page, "CI runner");
    const tokens = page.getByRole("table", { name: "Tokens" });
    await expect(tokens.getByRole("row", { name: /CI runner/ })).toContainText("Active");

    const listed = await asAgent(page, token, "/api/v1/projects?limit=100");
    expect(listed.status()).toBe(200);
    const { items } = (await listed.json()) as { items: { key: string }[] };
    expect(items.map((project) => project.key)).toEqual([allowed]);
    expect((await asAgent(page, token, `/api/v1/projects/${other}`)).status()).toBe(403);

    await tokens.getByRole("button", { name: "Revoke CI runner" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Revoke" }).click();
    await expect(tokens.getByRole("row", { name: /CI runner/ })).toContainText("Revoked");
    expect((await asAgent(page, token, "/api/v1/me")).status()).toBe(401);
  },
);

admin("an Admin disables and re-enables an agent, and edits its scopes", async ({ page }) => {
  const id = suffix();
  const created = await page.request.post("/api/v1/agents", {
    headers,
    data: { name: `Toggle bot ${id}`, role: "qa_agent", projectIds: null },
  });
  expect(created.status()).toBe(201);
  const { id: agentId } = (await created.json()) as { id: string };

  await page.goto(`/agents/${agentId}`);
  const token = await createTokenInUi(page, "Toggle");
  expect((await asAgent(page, token, "/api/v1/me")).status()).toBe(200);

  await page.getByRole("button", { name: "Disable agent" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Disable" }).click();
  await expect(page.getByRole("button", { name: "Re-enable agent" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create token" })).toBeDisabled();
  expect((await asAgent(page, token, "/api/v1/me")).status()).toBe(401);

  await page.getByRole("button", { name: "Re-enable agent" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Re-enable" }).click();
  await expect(page.getByRole("button", { name: "Disable agent" })).toBeVisible();
  expect((await asAgent(page, token, "/api/v1/me")).status()).toBe(200);

  await page.getByRole("button", { name: "Edit" }).click();
  const form = page.getByRole("dialog");
  await form.getByRole("checkbox", { name: /Comment on tasks/ }).click();
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form).toBeHidden();
  await expect(page.getByText("Comment on tasks")).toHaveCount(0);

  const me = await asAgent(page, token, "/api/v1/me");
  expect(((await me.json()) as { permissions: string[] }).permissions).not.toContain(
    "comments:write",
  );
});

base("a Manager has neither the Agents link nor the page", async ({ page }) => {
  const email = `agents-manager-${crypto.randomUUID()}@example.com`;
  await seedAccount({ email, password, role: "manager" });
  expect(
    (
      await page.request.post("/api/v1/auth/sign-in", { headers, data: { email, password } })
    ).status(),
  ).toBe(200);

  await page.goto("/projects");
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Projects" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Agents" })).toHaveCount(0);

  const response = await page.goto("/agents");
  expect(response?.status()).toBe(404);
});
