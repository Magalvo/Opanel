import { type Browser, expect, request as playwrightRequest, test } from "@playwright/test";

import { inviteResponseSchema, resetLinkResponseSchema } from "@/lib/schemas/accounts";

import { E2E_BASE_URL } from "./environment";
import { seedAccount } from "./seed";

const adminPassword = "an e2e admin password, long";
const firstPassword = "the first password I choose";
const secondPassword = "the second password I choose";
const origin = { Origin: E2E_BASE_URL };

async function setPasswordFromLink(browser: Browser, url: string, password: string) {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL });
  const page = await context.newPage();
  await page.goto(url);
  return { context, page, password };
}

test("an invited person sets a password and gets in; the link works once; a reset link replaces the password", async ({
  browser,
  request,
}) => {
  const adminEmail = `admin-${crypto.randomUUID()}@example.com`;
  await seedAccount({ email: adminEmail, password: adminPassword, role: "admin" });
  expect(
    (
      await request.post("/api/v1/auth/sign-in", {
        headers: origin,
        data: { email: adminEmail, password: adminPassword },
      })
    ).status(),
  ).toBe(200);

  const email = `grace-${crypto.randomUUID()}@example.com`;
  const invited = inviteResponseSchema.parse(
    await (
      await request.post("/api/v1/accounts", {
        headers: origin,
        data: { name: "Grace", email, role: "member" },
      })
    ).json(),
  );

  // The invited person opens the link in a fresh browser.
  const first = await setPasswordFromLink(browser, invited.link.url, firstPassword);
  try {
    await expect(first.page.getByLabel("Password", { exact: true })).toBeVisible();
    expect(first.page.url()).not.toContain("#");
    await first.page.getByLabel("Password", { exact: true }).fill(firstPassword);
    await first.page.getByLabel("Confirm password").fill(firstPassword);
    await first.page.getByRole("button", { name: "Set password" }).click();
    await expect(first.page).toHaveURL(`${E2E_BASE_URL}/`);
    await expect(first.page.getByRole("button", { name: "Account menu" })).toBeVisible();
  } finally {
    await first.context.close();
  }

  // The same link is refused the second time.
  const again = await setPasswordFromLink(browser, invited.link.url, firstPassword);
  try {
    await again.page.getByLabel("Password", { exact: true }).fill(secondPassword);
    await again.page.getByLabel("Confirm password").fill(secondPassword);
    await again.page.getByRole("button", { name: "Set password" }).click();
    await expect(
      again.page.getByText("This link is no longer valid. Ask an administrator for a new one."),
    ).toBeVisible();
  } finally {
    await again.context.close();
  }

  // An Admin issues a reset link: the new password replaces the old one.
  const reset = resetLinkResponseSchema.parse(
    await (
      await request.post(`/api/v1/accounts/${invited.account.id}/reset-link`, { headers: origin })
    ).json(),
  );
  const third = await setPasswordFromLink(browser, reset.link.url, secondPassword);
  try {
    await third.page.getByLabel("Password", { exact: true }).fill(secondPassword);
    await third.page.getByLabel("Confirm password").fill(secondPassword);
    await third.page.getByRole("button", { name: "Set password" }).click();
    await expect(third.page).toHaveURL(`${E2E_BASE_URL}/`);
  } finally {
    await third.context.close();
  }

  const api = await playwrightRequest.newContext({ baseURL: E2E_BASE_URL });
  try {
    const oldPassword = await api.post("/api/v1/auth/sign-in", {
      headers: origin,
      data: { email, password: firstPassword },
    });
    expect(oldPassword.status()).toBe(401);
    const newPassword = await api.post("/api/v1/auth/sign-in", {
      headers: origin,
      data: { email, password: secondPassword },
    });
    expect(newPassword.status()).toBe(200);
  } finally {
    await api.dispose();
  }
});
