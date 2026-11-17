import { type Page } from "@playwright/test";

import { expect, test } from "./base";
import { E2E_BASE_URL } from "./environment";
import { seedAccount } from "./seed";

const password = "an e2e events password, long enough";
const headers = { Origin: E2E_BASE_URL };

async function signInAs(page: Page, role: "manager" | "member"): Promise<void> {
  const email = `events-${role}-${crypto.randomUUID().slice(0, 8)}@example.com`;
  await seedAccount({ email, password, role, name: `Events ${role}` });
  const response = await page.request.post("/api/v1/auth/sign-in", {
    headers,
    data: { email, password },
  });
  expect(response.status()).toBe(200);
}

test("the events stream reaches the browser through next start, unbuffered (WS-047)", async ({
  page,
}) => {
  await signInAs(page, "manager");
  const key = `E${crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
  expect(
    (await page.request.post("/api/v1/projects", { headers, data: { key, name: key } })).status(),
  ).toBe(201);
  await page.goto("/");

  const encoding = await page.evaluate(async (path) => {
    const abort = new AbortController();
    const response = await fetch(path, { signal: abort.signal });
    const value = response.headers.get("Content-Encoding");
    abort.abort();
    return value;
  }, `/api/v1/projects/${key}/events`);
  expect(encoding).toBeNull();

  await page.evaluate((path) => {
    const received: string[] = [];
    Object.assign(window, { receivedEvents: received });
    const source = new EventSource(path);
    source.addEventListener("open", () => {
      received.push("open");
    });
    source.addEventListener("task.created", (event) => {
      received.push((event as MessageEvent<string>).data);
    });
  }, `/api/v1/projects/${key}/events`);
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { receivedEvents: string[] }).receivedEvents),
    )
    .toContain("open");

  const created = await page.request.post(`/api/v1/projects/${key}/tasks`, {
    headers,
    data: { title: "Pushed" },
  });
  expect(created.status()).toBe(201);
  const task = (await created.json()) as { id: string };

  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (window as unknown as { receivedEvents: string[] }).receivedEvents.join("\n"),
        ),
      { timeout: 5_000 },
    )
    .toContain(task.id);
});
