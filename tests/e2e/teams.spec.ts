import { expect, type Page, test } from "@playwright/test";

import { E2E_BASE_URL } from "./environment";
import { seedAccount } from "./seed";

const password = "an e2e teams password, long";

/** Seeds a person with a unique name and signs the page in as them; returns the name. */
async function signInAs(page: Page, role: "manager" | "viewer"): Promise<string> {
  const id = crypto.randomUUID().slice(0, 8);
  const email = `${role}-${id}@example.com`;
  await seedAccount({ email, password, role, name: `${role} ${id}` });
  const response = await page.request.post("/api/v1/auth/sign-in", {
    headers: { Origin: E2E_BASE_URL },
    data: { email, password },
  });
  expect(response.status()).toBe(200);
  return `${role} ${id}`;
}

/** Seeds an active member with a unique name, findable in the people search. */
async function seedPerson(first: string): Promise<string> {
  const id = crypto.randomUUID().slice(0, 8);
  const name = `${first} ${id}`;
  await seedAccount({
    email: `${first.toLowerCase()}-${id}@example.com`,
    password,
    role: "member",
    name,
  });
  return name;
}

async function createTeamThroughApi(page: Page, name: string): Promise<string> {
  const response = await page.request.post("/api/v1/teams", {
    headers: { Origin: E2E_BASE_URL },
    data: { name },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function addMember(page: Page, name: string) {
  await page.getByRole("button", { name: "Add member" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a member" });
  await dialog.getByLabel("Search people").fill(name);
  await dialog.getByRole("button", { name: `Add ${name}` }).click();
  await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible();
}

test("a Manager creates a team, adds and removes people, renames it and deletes it", async ({
  page,
}) => {
  await signInAs(page, "manager");
  const ada = await seedPerson("Ada");
  const grace = await seedPerson("Grace");
  const name = `Frontend ${crypto.randomUUID().slice(0, 8)}`;

  await page.goto("/");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Teams" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Teams" })).toBeVisible();

  await page.getByRole("button", { name: "New team" }).click();
  const dialog = page.getByRole("dialog", { name: "New team" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page).toHaveURL(/\/teams\/[0-9a-f-]{36}$/);

  await addMember(page, ada);
  await addMember(page, grace);

  await page.getByRole("button", { name: "Rename" }).click();
  const rename = page.getByRole("dialog", { name: "Rename team" });
  await rename.getByLabel("Name").fill(`${name} Web`);
  await rename.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `${name} Web` })).toBeVisible();

  await page.getByRole("button", { name: `Remove ${ada} from ${name} Web` }).click();
  await expect(page.getByRole("status")).toContainText(`${ada} was removed`);
  await page.reload();
  await expect(page.getByRole("row", { name: new RegExp(grace) })).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(ada) })).toHaveCount(0);

  await page.getByRole("button", { name: "Delete team" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/teams$/);
  await expect(page.getByRole("heading", { level: 1, name: "Teams" })).toBeVisible();
});

test("a team that a task is assigned to cannot be deleted, and the page says why", async ({
  page,
}) => {
  await signInAs(page, "manager");
  const teamId = await createTeamThroughApi(page, `Backend ${crypto.randomUUID().slice(0, 8)}`);
  const key = `T${crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
  const headers = { Origin: E2E_BASE_URL };
  expect(
    (await page.request.post("/api/v1/projects", { headers, data: { key, name: key } })).status(),
  ).toBe(201);
  expect(
    (
      await page.request.post(`/api/v1/projects/${key}/tasks`, {
        headers,
        data: { title: "Assigned", assigneeTeamId: teamId },
      })
    ).status(),
  ).toBe(201);

  await page.goto(`/teams/${teamId}`);
  await page.getByRole("button", { name: "Delete team" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();

  await expect(page.getByRole("status")).toContainText("Tasks are assigned to this team.");
  await expect(page).toHaveURL(new RegExp(`/teams/${teamId}$`));
});

test("a Viewer sees Teams in the sidebar and both pages without any control", async ({
  page,
  browser,
}) => {
  const manager = await browser.newPage({ baseURL: E2E_BASE_URL });
  await signInAs(manager, "manager");
  const name = `QA ${crypto.randomUUID().slice(0, 8)}`;
  const teamId = await createTeamThroughApi(manager, name);
  await manager.close();
  await signInAs(page, "viewer");

  await page.goto("/teams");
  await expect(page.getByRole("heading", { level: 1, name: "Teams" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New team" })).toHaveCount(0);

  await page.goto(`/teams/${teamId}`);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  for (const control of ["Rename", "Add member", "Delete team"]) {
    await expect(page.getByRole("button", { name: control })).toHaveCount(0);
  }
});

test("at phone width the teams pages have no horizontal page scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signInAs(page, "manager");
  const teamId = await createTeamThroughApi(
    page,
    `A team with a rather long name ${crypto.randomUUID()}`,
  );

  for (const path of ["/teams", `/teams/${teamId}`]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
