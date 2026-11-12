import { expect, test } from "@playwright/test";

import { meResponseSchema } from "@/lib/schemas/auth";

import { E2E_BASE_URL } from "./environment";

const password = "an e2e password, long enough";

// Runs alone and first (the `first-run` project): it needs a database with no accounts.
test("the first visitor creates the Admin, ends up signed in, and /setup disappears", async ({
  page,
}) => {
  // A visitor to an empty install is led from the home page to the setup page.
  await page.goto("/");
  await expect(page).toHaveURL("/setup");

  await page.getByLabel("Name").fill("First Admin");
  await page.getByLabel("Email").fill("first-admin@example.com");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create administrator" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
  const me = await page.request.get("/api/v1/me");
  expect(me.status()).toBe(200);
  expect(meResponseSchema.parse(await me.json())).toMatchObject({
    email: "first-admin@example.com",
    role: "admin",
  });

  const again = await page.goto("/setup");
  expect(again?.status()).toBe(404);
  const api = await page.request.post("/api/v1/setup", {
    headers: { Origin: E2E_BASE_URL },
    data: { name: "Second", email: "second@example.com", password },
  });
  expect(api.status()).toBe(404);
});
