// Starting a sprint through its route handler (WS-142 test 15): the body, each code, Sprint.
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { sprintSchema } from "@/lib/schemas/sprints";
import { apiRequest, createTestAccount, signInCookie, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { createProject, updateProject } from "@/server/services/projects";
import { createSprint } from "@/server/services/sprints";
import { createTask } from "@/server/services/tasks";

import { POST } from "./route";

const UNKNOWN = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";
const DATES = { startDate: "2026-12-01", endDate: "2026-12-14" };

async function setup() {
  const account = await createTestAccount({
    name: "Manager",
    email: "manager@example.com",
    role: "manager",
  });
  await createTestAccount({ name: "Mia", email: "mia@example.com", role: "member" });
  const manager = testActor(account);
  const project = await createProject(manager, { key: "OPA", name: "Opanel" });
  await updateProject(manager, "OPA", { sprintsEnabled: true, version: 1 });
  const one = await createSprint(manager, "OPA", { name: "Sprint 1", ...DATES });
  const two = await createSprint(manager, "OPA", { name: "Sprint 2", ...DATES });
  return {
    manager,
    project,
    one,
    two,
    cookie: await signInCookie("manager@example.com"),
    member: await signInCookie("mia@example.com"),
  };
}

function start(cookie: string, sprintId: string, body: unknown) {
  return POST(apiRequest("POST", `/api/v1/sprints/${sprintId}/start`, { cookie, body }), {
    params: Promise.resolve({ sprintId }),
  });
}

describe("POST /api/v1/sprints/{sprintId}/start", () => {
  it("starts a planned sprint and answers the Sprint with its progress", async () => {
    const s = await setup();
    await createTask(s.manager, "OPA", { title: "A", sprintId: s.one.id, storyPoints: 2 });

    const response = await start(s.cookie, s.one.id, { version: 1 });

    expect(response.status).toBe(200);
    expect(sprintSchema.parse(await response.json())).toMatchObject({
      state: "active",
      version: 2,
      progress: { doneTasks: 0, totalTasks: 1, donePoints: 0, totalPoints: 2, unestimated: 0 },
    });
  });

  it("reads the body: version is required, nothing else is taken", async () => {
    const s = await setup();

    expect((await start(s.cookie, s.one.id, {})).status).toBe(400);
    expect((await start(s.cookie, s.one.id, { version: 1, name: "X" })).status).toBe(400);
    expect((await start(s.cookie, "not-a-uuid", { version: 1 })).status).toBe(400);
    expect((await start(s.cookie, UNKNOWN, { version: 1 })).status).toBe(404);
  });

  it("answers each code", async () => {
    const s = await setup();
    expect((await start(s.member, s.one.id, { version: 1 })).status).toBe(403);

    await getDb().execute(
      sql`update projects set sprints_enabled = false where id = ${s.project.id}`,
    );
    expect(await (await start(s.cookie, s.one.id, { version: 1 })).json()).toMatchObject({
      status: 409,
      code: "sprints_disabled",
    });
    await getDb().execute(sql`update projects set sprints_enabled = true where id = ${s.project.id}`);

    const stale = await start(s.cookie, s.one.id, { version: 4 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      code: "version_conflict",
      current: { id: s.one.id, version: 1, progress: { totalTasks: 0 } },
    });

    expect((await start(s.cookie, s.one.id, { version: 1 })).status).toBe(200);
    expect(await (await start(s.cookie, s.one.id, { version: 2 })).json()).toMatchObject({
      status: 409,
      code: "sprint_not_planned",
    });
    expect(await (await start(s.cookie, s.two.id, { version: 1 })).json()).toMatchObject({
      status: 409,
      code: "sprint_active",
    });
  });
});
