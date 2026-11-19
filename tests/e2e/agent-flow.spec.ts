import { expect, test } from "./base";
import { E2E_BASE_URL } from "./environment";
import { seedAccount } from "./seed";

// The whole agent flow, as an agent author lives it (WS-078 section 2): an Admin sets the
// agent up in the UI, then a program that holds only the token works within exactly what
// it was given, and people see its work as the agent's.

const password = "an e2e agent flow password, long";
const headers = { Origin: E2E_BASE_URL };

test("an agent set up in the UI works with its token alone, within its scopes and project", async ({
  page,
  playwright,
}) => {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase();
  const email = `flow-admin-${id.toLowerCase()}@example.com`;
  await seedAccount({ email, password, role: "admin", name: `Flow Admin ${id}` });
  expect(
    (
      await page.request.post("/api/v1/auth/sign-in", { headers, data: { email, password } })
    ).status(),
  ).toBe(200);

  // 1. The Admin: two projects, a task, and the agent with its token, in the UI.
  const [mine, other] = [`F${id}`, `G${id}`];
  for (const key of [mine, other]) {
    const created = await page.request.post("/api/v1/projects", {
      headers,
      data: { key, name: `Flow ${key}` },
    });
    expect(created.status()).toBe(201);
  }
  const madeTask = await page.request.post(`/api/v1/projects/${mine}/tasks`, {
    headers,
    data: { title: "Checkout returns 500" },
  });
  expect(madeTask.status()).toBe(201);
  const { key: taskKey } = (await madeTask.json()) as { key: string };

  const botName = `Flow bot ${id}`;
  await page.goto("/agents");
  await page.getByRole("button", { name: "New agent" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Name").fill(botName);
  await form.getByRole("radio", { name: "Only these projects" }).check();
  await form.getByRole("checkbox", { name: `Flow ${mine}` }).click();
  await form.getByRole("button", { name: "Create agent" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(botName) })).toBeVisible();

  await page.getByRole("button", { name: "Create token" }).click();
  const tokenDialog = page.getByRole("dialog");
  await tokenDialog.getByLabel("Token name").fill("Flow");
  await tokenDialog.getByRole("button", { name: "Create token" }).click();
  const field = tokenDialog.getByLabel("Token", { exact: true });
  await expect(field).toHaveValue(/^opk_/);
  const token = await field.inputValue();
  await tokenDialog.getByRole("button", { name: "Done" }).click();

  // 2. The agent: a client with the token and nothing else, no cookie.
  const agent = await playwright.request.newContext({
    baseURL: E2E_BASE_URL,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
  try {
    const me = (await (await agent.get("/api/v1/me")).json()) as {
      kind: string;
      name: string;
      permissions: string[];
      projectIds: string[] | null;
    };
    expect(me).toMatchObject({ kind: "agent", name: botName });
    expect([...me.permissions].sort()).toEqual([
      "comments:write",
      "projects:read",
      "reports:write",
      "tasks:read",
    ]);
    expect(me.projectIds).toHaveLength(1);

    const projects = (await (await agent.get("/api/v1/projects?limit=100")).json()) as {
      items: { id: string; key: string }[];
    };
    expect(projects.items.map((project) => project.key)).toEqual([mine]);
    expect(projects.items[0]?.id).toBe(me.projectIds?.[0]);

    expect((await agent.get(`/api/v1/tasks/${taskKey}`)).status()).toBe(200);
    const comment = await agent.post(`/api/v1/tasks/${taskKey}/comments`, {
      data: { body: "Reproduced: the payment call answers 500." },
    });
    expect(comment.status()).toBe(201);
    expect(((await comment.json()) as { author: { name: string; kind: string } }).author).toEqual(
      expect.objectContaining({ name: botName, kind: "agent" }),
    );

    expect((await agent.get(`/api/v1/projects/${other}`)).status()).toBe(403);
    expect(
      (
        await agent.post(`/api/v1/projects/${mine}/tasks`, { data: { title: "Not allowed" } })
      ).status(),
    ).toBe(403);

    // The events stream: open for its project, refused for the other one.
    const controller = new AbortController();
    const stream = await fetch(`${E2E_BASE_URL}/api/v1/projects/${mine}/events`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const reader = stream.body?.getReader();
    const first = await reader?.read();
    expect(new TextDecoder().decode(first?.value)).toContain(": connected");
    controller.abort();
    expect(
      (
        await fetch(`${E2E_BASE_URL}/api/v1/projects/${other}/events`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(403);
  } finally {
    await agent.dispose();
  }

  // 3. The Admin sees the agent's comment as the agent's.
  await page.goto(`/projects/${mine}`);
  await page.getByRole("link", { name: "Checkout returns 500" }).click();
  const comments = page.getByRole("dialog").getByRole("region", { name: "Comments" });
  await expect(comments.getByRole("article")).toHaveCount(1);
  await expect(comments.getByRole("article").first()).toContainText(`${botName}Agent`);
});
