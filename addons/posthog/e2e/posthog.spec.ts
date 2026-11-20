import { type APIRequestContext, expect, test } from "@playwright/test";

import { seedAccount } from "../../../tests/e2e/seed";
import { readJson, render } from "../tests/render";
import { ADDON_BASE_URL } from "./environment";

// WS-092 section 4, tests 8 to 10: the bodies, rendered as PostHog renders them and sent
// with the agent's token as PostHog's secret header sends it, go through the real app's
// bug report endpoint and triage pipeline. PostHog itself is not under test.

const addon = new URL("../", import.meta.url);
const body = (name: string) => readJson(new URL(`bodies/body-${name}.json`, addon));
const fixture = (name: string) => readJson(new URL(`fixtures/${name}.json`, addon));

const password = "an e2e posthog add-on password, long";
const headers = { Origin: ADDON_BASE_URL };

interface Task {
  key: string;
  assigneeTeam: { id: string } | null;
  reporter: { name: string; kind: string };
  occurrences: number;
}

async function json<T>(response: Awaited<ReturnType<APIRequestContext["get"]>>, status: number) {
  expect(response.status(), await response.text()).toBe(status);
  return (await response.json()) as T;
}

test("PostHog alerts become routed, deduplicated bugs filed by the add-on's agent", async ({
  request,
  playwright,
}) => {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase();
  const email = `posthog-admin-${id.toLowerCase()}@example.com`;
  await seedAccount({ email, password, role: "admin", name: `PostHog Admin ${id}` });
  await json(
    await request.post("/api/v1/auth/sign-in", { headers, data: { email, password } }),
    200,
  );

  // The Admin's set-up from the guide: a project, its teams and routing, an agent and token.
  const key = `P${id}`;
  const project = await json<{ id: string }>(
    await request.post("/api/v1/projects", { headers, data: { key, name: `PostHog ${key}` } }),
    201,
  );
  const team = async (name: string) =>
    (
      await json<{ id: string }>(
        await request.post("/api/v1/teams", { headers, data: { name } }),
        201,
      )
    ).id;
  const frontend = await team(`Frontend ${id}`);
  const triage = await team(`Triage ${id}`);
  const { version } = await json<{ version: number }>(
    await request.get(`/api/v1/projects/${key}/triage`),
    200,
  );
  await json(
    await request.patch(`/api/v1/projects/${key}/triage`, {
      headers,
      data: { triageTeamId: triage, rules: { frontend }, version },
    }),
    200,
  );

  const botName = `PostHog ${id}`;
  const agent = await json<{ id: string }>(
    await request.post("/api/v1/agents", {
      headers,
      data: {
        name: botName,
        role: "qa_agent",
        scopes: ["projects:read", "reports:write"],
        projectIds: [project.id],
      },
    }),
    201,
  );
  const { token } = await json<{ token: string }>(
    await request.post(`/api/v1/agents/${agent.id}/tokens`, { headers, data: { name: "PostHog" } }),
    201,
  );

  // PostHog's webhook: the rendered body, the token in the Authorization header, no cookie.
  const posthog = await playwright.request.newContext({
    baseURL: ADDON_BASE_URL,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
  try {
    const send = (name: string, event: string) =>
      posthog.post(`/api/v1/projects/${key}/bug-reports`, {
        data: render(body(name), fixture(event)),
      });

    // 8. A new client-side issue: a bug for the frontend team, reported by the agent.
    const created = await json<{ outcome: string; taskKey: string; assignedTeamId: string }>(
      await send("frontend", "created-web"),
      201,
    );
    expect(created).toMatchObject({ outcome: "created", assignedTeamId: frontend });
    const task = await json<Task>(await request.get(`/api/v1/tasks/${created.taskKey}`), 200);
    expect(task.reporter).toMatchObject({ name: botName, kind: "agent" });
    expect(task.assigneeTeam?.id).toBe(frontend);

    // 9. The same issue reopened in PostHog: counted on the same open bug.
    const repeated = await json<{ outcome: string; taskKey: string; occurrences: number }>(
      await send("frontend", "reopened-web"),
      200,
    );
    expect(repeated).toEqual(
      expect.objectContaining({
        outcome: "deduplicated",
        taskKey: created.taskKey,
        occurrences: 2,
      }),
    );

    // 10. The basic set-up: a spike on another issue reaches the triage team.
    const spike = fixture("spiking") as { event: { distinct_id: string } };
    spike.event.distinct_id = "0192f6d4-0002-7000-8000-000000000def";
    const unrouted = await json<{ outcome: string; assignedTeamId: string }>(
      await posthog.post(`/api/v1/projects/${key}/bug-reports`, {
        data: render(body("unknown"), spike),
      }),
      201,
    );
    expect(unrouted).toMatchObject({ outcome: "created", assignedTeamId: triage });
  } finally {
    await posthog.dispose();
  }
});
