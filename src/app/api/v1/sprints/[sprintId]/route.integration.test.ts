// One sprint through its route handlers (WS-140 test 12): read, edit, delete and each code.
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { sprintSchema } from "@/lib/schemas/sprints";
import { apiRequest, createTestAccount, signInCookie } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";

import { PATCH as patchProject } from "../../projects/[projectId]/route";
import { POST as create } from "../../projects/[projectId]/sprints/route";
import { POST as createProject } from "../../projects/route";
import { DELETE, GET, PATCH } from "./route";

const project = { params: Promise.resolve({ projectId: "OPA" }) };

function sprintContext(sprintId: string) {
  return { params: Promise.resolve({ sprintId }) };
}

async function cookieFor(role: "viewer" | "member" | "manager") {
  await createTestAccount({ name: role, email: `${role}@example.com`, role });
  return signInCookie(`${role}@example.com`);
}

async function setup() {
  const manager = await cookieFor("manager");
  const member = await cookieFor("member");
  const viewer = await cookieFor("viewer");
  await createProject(
    apiRequest("POST", "/api/v1/projects", { cookie: manager, body: { key: "OPA", name: "O" } }),
    undefined,
  );
  await patchProject(
    apiRequest("PATCH", "/api/v1/projects/OPA", {
      cookie: manager,
      body: { sprintsEnabled: true, version: 1 },
    }),
    project,
  );
  const newSprint = async (name: string) =>
    sprintSchema.parse(
      await (
        await create(
          apiRequest("POST", "/api/v1/projects/OPA/sprints", {
            cookie: manager,
            body: { name, startDate: "2026-12-01", endDate: "2026-12-14" },
          }),
          project,
        )
      ).json(),
    );
  return { manager, member, viewer, newSprint };
}

function patch(cookie: string, sprintId: string, body: unknown) {
  return PATCH(
    apiRequest("PATCH", `/api/v1/sprints/${sprintId}`, { cookie, body }),
    sprintContext(sprintId),
  );
}

function remove(cookie: string, sprintId: string) {
  return DELETE(
    apiRequest("DELETE", `/api/v1/sprints/${sprintId}`, { cookie }),
    sprintContext(sprintId),
  );
}

describe("GET, PATCH and DELETE /api/v1/sprints/{sprintId}", () => {
  it("reads, edits with a version, conflicts and deletes", async () => {
    const { manager, viewer, newSprint } = await setup();
    const sprint = await newSprint("Sprint 1");

    const read = await GET(
      apiRequest("GET", `/api/v1/sprints/${sprint.id}`, { cookie: viewer }),
      sprintContext(sprint.id),
    );
    expect(read.status).toBe(200);
    expect(sprintSchema.parse(await read.json())).toEqual(sprint);

    const edited = await patch(manager, sprint.id, { goal: "Ship", version: 1 });
    expect(edited.status).toBe(200);
    expect(sprintSchema.parse(await edited.json())).toMatchObject({ goal: "Ship", version: 2 });

    const stale = await patch(manager, sprint.id, { name: "Old", version: 1 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      code: "version_conflict",
      current: { goal: "Ship", version: 2 },
    });

    const badDates = await patch(manager, sprint.id, { endDate: "2026-11-01", version: 2 });
    expect(badDates.status).toBe(400);
    expect(await badDates.json()).toMatchObject({
      errors: [expect.objectContaining({ path: "endDate" })],
    });
    const empty = await patch(manager, sprint.id, { version: 2 });
    expect(empty.status).toBe(400);

    const deleted = await remove(manager, sprint.id);
    expect(deleted.status).toBe(204);
    const gone = await GET(
      apiRequest("GET", `/api/v1/sprints/${sprint.id}`, { cookie: viewer }),
      sprintContext(sprint.id),
    );
    expect(gone.status).toBe(404);
  });

  it("answers sprint_completed, sprint_not_planned, sprint_active and the refusals", async () => {
    const { manager, member, newSprint } = await setup();
    const completed = await newSprint("Done");
    const active = await newSprint("Now");
    await getDb().execute(sql`
      update sprints set state = 'completed', started_at = now(), completed_at = now(),
        total_points = 0, completed_points = 0, total_tasks = 0, completed_tasks = 0,
        unestimated = 0
      where id = ${completed.id}`);
    await getDb().execute(
      sql`update sprints set state = 'active', started_at = now() where id = ${active.id}`,
    );

    const editCompleted = await patch(manager, completed.id, { name: "X", version: 1 });
    expect(editCompleted.status).toBe(409);
    expect(await editCompleted.json()).toMatchObject({ code: "sprint_completed" });
    for (const sprint of [completed, active]) {
      const refused = await remove(manager, sprint.id);
      expect(refused.status).toBe(409);
      expect(await refused.json()).toMatchObject({ code: "sprint_not_planned" });
    }
    const turnOff = await patchProject(
      apiRequest("PATCH", "/api/v1/projects/OPA", {
        cookie: manager,
        body: { sprintsEnabled: false, version: 2 },
      }),
      project,
    );
    expect(turnOff.status).toBe(409);
    expect(await turnOff.json()).toMatchObject({ code: "sprint_active" });

    const statuses = await Promise.all([
      patch(member, active.id, { name: "X", version: 1 }),
      remove(member, active.id),
      GET(apiRequest("GET", `/api/v1/sprints/${active.id}`), sprintContext(active.id)),
      GET(
        apiRequest("GET", "/api/v1/sprints/not-a-uuid", { cookie: member }),
        sprintContext("not-a-uuid"),
      ),
    ]);
    expect(statuses.map((response) => response.status)).toEqual([403, 403, 401, 400]);
  });

  it("answers sprints_disabled for an edit while sprints are off", async () => {
    const { manager, newSprint } = await setup();
    const sprint = await newSprint("Later");
    await patchProject(
      apiRequest("PATCH", "/api/v1/projects/OPA", {
        cookie: manager,
        body: { sprintsEnabled: false, version: 2 },
      }),
      project,
    );

    const refused = await patch(manager, sprint.id, { name: "X", version: 1 });

    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "sprints_disabled" });
  });
});
