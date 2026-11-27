// Completing a sprint through its route handler (WS-142 test 15): the body, each code and
// CompletedSprint.
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { completedSprintSchema } from "@/lib/schemas/sprints";
import { apiRequest, createTestAccount, signInCookie, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { listColumns } from "@/server/services/columns";
import { createProject, updateProject } from "@/server/services/projects";
import { createSprint, startSprint } from "@/server/services/sprints";
import { createTask, moveTask } from "@/server/services/tasks";

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

function complete(cookie: string, sprintId: string, body: unknown) {
  return POST(apiRequest("POST", `/api/v1/sprints/${sprintId}/complete`, { cookie, body }), {
    params: Promise.resolve({ sprintId }),
  });
}

describe("POST /api/v1/sprints/{sprintId}/complete", () => {
  it("completes the active sprint and answers a CompletedSprint", async () => {
    const s = await setup();
    const [, , done] = (await listColumns(s.manager, "OPA")).items;
    if (!done) throw new Error("no columns");
    const parent = await createTask(s.manager, "OPA", { title: "P", sprintId: s.one.id });
    await createTask(s.manager, "OPA", { title: "S", parentId: parent.key });
    await startSprint(s.manager, s.one.id, { version: 1 });
    await moveTask(s.manager, parent.key, { columnId: done.id, version: 2 });

    const response = await complete(s.cookie, s.one.id, {
      moveUnfinishedTo: s.two.id,
      version: 2,
    });

    expect(response.status).toBe(200);
    expect(completedSprintSchema.parse(await response.json())).toMatchObject({
      state: "completed",
      version: 3,
      unfinishedSubtasksKept: 1,
      progress: { doneTasks: 1, totalTasks: 2 },
    });
  });

  it("reads the body: moveUnfinishedTo and version are required, nothing else is taken", async () => {
    const s = await setup();
    await startSprint(s.manager, s.one.id, { version: 1 });

    expect((await complete(s.cookie, s.one.id, { version: 2 })).status).toBe(400);
    expect((await complete(s.cookie, s.one.id, { moveUnfinishedTo: null })).status).toBe(400);
    expect(
      (await complete(s.cookie, s.one.id, { moveUnfinishedTo: "soon", version: 2 })).status,
    ).toBe(400);
    expect(
      (await complete(s.cookie, s.one.id, { moveUnfinishedTo: null, version: 2, x: 1 })).status,
    ).toBe(400);
    expect(
      (await complete(s.cookie, UNKNOWN, { moveUnfinishedTo: null, version: 1 })).status,
    ).toBe(404);
  });

  it("answers each code", async () => {
    const s = await setup();
    expect(
      await (await complete(s.cookie, s.one.id, { moveUnfinishedTo: null, version: 1 })).json(),
    ).toMatchObject({ status: 409, code: "sprint_not_active" });
    await startSprint(s.manager, s.one.id, { version: 1 });

    expect(
      (await complete(s.member, s.one.id, { moveUnfinishedTo: null, version: 2 })).status,
    ).toBe(403);
    const target = await complete(s.cookie, s.one.id, { moveUnfinishedTo: UNKNOWN, version: 2 });
    expect(target.status).toBe(400);
    expect(await target.json()).toMatchObject({
      errors: [expect.objectContaining({ path: "moveUnfinishedTo" })],
    });
    expect(
      await (await complete(s.cookie, s.one.id, { moveUnfinishedTo: null, version: 1 })).json(),
    ).toMatchObject({
      status: 409,
      code: "version_conflict",
      current: { id: s.one.id, version: 2 },
    });

    await getDb().execute(
      sql`update projects set sprints_enabled = false where id = ${s.project.id}`,
    );
    expect(
      await (await complete(s.cookie, s.one.id, { moveUnfinishedTo: null, version: 2 })).json(),
    ).toMatchObject({ status: 409, code: "sprints_disabled" });
  });
});
