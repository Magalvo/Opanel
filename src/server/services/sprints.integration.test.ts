// Sprints: create, list, read, edit, delete, and who may do what (WS-140 tests 2 to 9).
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { agentActor } from "@/server/auth/actor";
import { createTestAccount, createTestAgent, failAuditFor, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { auditLog, taskEvents } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

import { listenForEvents } from "./events-testing";
import { archiveProject, createProject, updateProject } from "./projects";
import { createSprint, deleteSprint, getSprint, listSprints, updateSprint } from "./sprints";
import { createTask, deleteTask, getTask, listBacklog } from "./tasks";

const UNKNOWN = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";

async function setup({ enabled = true }: { enabled?: boolean } = {}) {
  const managerAccount = await createTestAccount({ email: "manager@example.com", role: "manager" });
  const manager = testActor(managerAccount);
  const member = testActor(await createTestAccount({ email: "mia@example.com", role: "member" }));
  const viewer = testActor(await createTestAccount({ email: "vic@example.com", role: "viewer" }));
  const project = await createProject(manager, { key: "OPA", name: "Opanel" });
  if (enabled) await updateProject(manager, "OPA", { sprintsEnabled: true, version: 1 });
  return { manager, managerAccount, member, viewer, project };
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected a failure");
}

async function audits(action: string) {
  return getDb().select().from(auditLog).where(eq(auditLog.action, action)).orderBy(auditLog.id);
}

async function sprintCount(): Promise<number> {
  const [row] = await getDb().execute<{ count: number }>(
    sql`select count(*)::int as count from sprints`,
  );
  return row?.count ?? 0;
}

/** Item D starts sprints; until then a test sets the state in the database. */
async function makeActive(sprintId: string): Promise<void> {
  await getDb().execute(
    sql`update sprints set state = 'active', started_at = now() where id = ${sprintId}`,
  );
}

async function makeCompleted(sprintId: string): Promise<void> {
  await getDb().execute(sql`
    update sprints set state = 'completed', started_at = now(), completed_at = now(),
      total_points = 0, completed_points = 0, total_tasks = 0, completed_tasks = 0,
      unestimated = 0
    where id = ${sprintId}`);
}

async function agent(scopes: string[], projectIds: string[] | null = null) {
  const account = await createTestAgent({
    role: "worker_agent",
    scopes: scopes as never,
    projectIds,
  });
  return agentActor({ accountId: account.id, role: "worker_agent", scopes, projectIds });
}

const DATES = { startDate: "2026-12-01", endDate: "2026-12-14" };

describe("createSprint (WS-140 test 2)", () => {
  it("creates a planned sprint, records sprint.created and sends sprint.changed", async () => {
    const { manager, managerAccount, project } = await setup();
    const listener = await listenForEvents();
    try {
      const sprint = await createSprint(manager, "OPA", {
        name: "Sprint 1",
        goal: "Sign-in works",
        ...DATES,
      });
      const bare = await createSprint(manager, project.id, { name: "Sprint 2", ...DATES });

      expect(sprint).toEqual({
        id: expect.any(String) as unknown,
        projectId: project.id,
        name: "Sprint 1",
        goal: "Sign-in works",
        startDate: "2026-12-01",
        endDate: "2026-12-14",
        state: "planned",
        startedAt: null,
        completedAt: null,
        progress: { doneTasks: 0, totalTasks: 0, donePoints: 0, totalPoints: 0, unestimated: 0 },
        version: 1,
        createdAt: expect.any(String) as unknown,
        updatedAt: expect.any(String) as unknown,
      });
      expect(bare.goal).toBe("");
      expect(await audits("sprint.created")).toMatchObject([
        {
          actorAccountId: managerAccount.id,
          entity: "sprint",
          entityId: sprint.id,
          data: { projectId: project.id, name: "Sprint 1" },
        },
        { entityId: bare.id, data: { projectId: project.id, name: "Sprint 2" } },
      ]);

      await listener.settle();
      expect(
        listener
          .events()
          .filter((event) => event.type === "sprint.changed")
          .map((event) => [event.entity, event.projectId, event.entityId, event.version]),
      ).toEqual([
        ["sprint", project.id, sprint.id, 1],
        ["sprint", project.id, bare.id, 1],
      ]);
    } finally {
      await listener.close();
    }
  });
});

describe("create refusals (WS-140 test 3)", () => {
  it("refuses an end date before the start date with a 400 on endDate", async () => {
    const { manager } = await setup();

    const error = await failure(
      createSprint(manager, "OPA", { name: "S", startDate: "2026-12-10", endDate: "2026-12-09" }),
    );

    expect(error.status).toBe(400);
    expect(error.errors?.map((field) => field.path)).toEqual(["endDate"]);
    expect(await sprintCount()).toBe(0);
  });

  it("refuses a project without sprints and an archived project, writing nothing", async () => {
    const { manager } = await setup({ enabled: false });

    expect((await failure(createSprint(manager, "OPA", { name: "S", ...DATES }))).code).toBe(
      "sprints_disabled",
    );
    await updateProject(manager, "OPA", { sprintsEnabled: true, version: 1 });
    await archiveProject(manager, "OPA");
    expect((await failure(createSprint(manager, "OPA", { name: "S", ...DATES }))).code).toBe(
      "project_archived",
    );
    expect((await failure(createSprint(manager, "NOPE", { name: "S", ...DATES }))).status).toBe(
      404,
    );
    expect(await sprintCount()).toBe(0);
    expect(await audits("sprint.created")).toEqual([]);
  });
});

describe("listSprints (WS-140 test 4)", () => {
  it("orders by start date, then creation, pages with a cursor, and filters by state", async () => {
    const { manager, member } = await setup();
    const late = await createSprint(manager, "OPA", {
      name: "Late",
      startDate: "2026-12-15",
      endDate: "2026-12-28",
    });
    const firstEarly = await createSprint(manager, "OPA", { name: "Early A", ...DATES });
    const secondEarly = await createSprint(manager, "OPA", { name: "Early B", ...DATES });
    const past = await createSprint(manager, "OPA", {
      name: "Past",
      startDate: "2026-11-01",
      endDate: "2026-11-14",
    });
    await makeCompleted(past.id);
    await makeActive(firstEarly.id);

    const first = await listSprints(member, "OPA", { limit: 2 });
    const second = await listSprints(member, "OPA", { limit: 2, cursor: first.nextCursor ?? "" });
    const names = async (state?: ("planned" | "active" | "completed")[]) =>
      (await listSprints(member, "OPA", { limit: 50, ...(state ? { state } : {}) })).items.map(
        (sprint) => sprint.name,
      );

    expect([...first.items, ...second.items].map((sprint) => sprint.id)).toEqual([
      past.id,
      firstEarly.id,
      secondEarly.id,
      late.id,
    ]);
    expect(second.nextCursor).toBeNull();
    expect(first.items[1]?.state).toBe("active");
    expect(await names(["planned"])).toEqual(["Early B", "Late"]);
    expect(await names(["planned", "active"])).toEqual(["Early A", "Early B", "Late"]);
    expect(await names(["completed"])).toEqual(["Past"]);
    expect((await failure(listSprints(member, "NOPE", { limit: 50 }))).status).toBe(404);
    expect(
      (await failure(listSprints(member, "OPA", { limit: 50, cursor: "nonsense" }))).errors,
    ).toEqual([expect.objectContaining({ path: "cursor" })]);
  });

  it("lists only the project's own sprints", async () => {
    const { manager, member } = await setup();
    await createProject(manager, { key: "WEB", name: "Web" });
    await updateProject(manager, "WEB", { sprintsEnabled: true, version: 1 });
    await createSprint(manager, "WEB", { name: "Elsewhere", ...DATES });

    expect((await listSprints(member, "OPA", { limit: 50 })).items).toEqual([]);
  });
});

describe("updateSprint (WS-140 test 5)", () => {
  it("edits each field, records the changed ones, sends sprint.changed and detects stale versions", async () => {
    const { manager, project } = await setup();
    const sprint = await createSprint(manager, "OPA", { name: "S", ...DATES });
    const listener = await listenForEvents();
    try {
      const renamed = await updateSprint(manager, sprint.id, {
        name: "Sprint 1",
        goal: "Ship",
        version: 1,
      });
      const moved = await updateSprint(manager, sprint.id, {
        startDate: "2026-12-02",
        endDate: "2026-12-16",
        version: 2,
      });
      const same = await updateSprint(manager, sprint.id, { name: "Sprint 1", version: 3 });

      expect(renamed).toMatchObject({ name: "Sprint 1", goal: "Ship", version: 2 });
      expect(moved).toMatchObject({ startDate: "2026-12-02", endDate: "2026-12-16", version: 3 });
      expect(same.version).toBe(4);
      expect((await audits("sprint.updated")).map((row) => [row.entityId, row.data])).toEqual([
        [sprint.id, { projectId: project.id, changed: ["name", "goal"] }],
        [sprint.id, { projectId: project.id, changed: ["startDate", "endDate"] }],
      ]);

      const stale = await failure(updateSprint(manager, sprint.id, { name: "Old", version: 1 }));
      expect(stale.code).toBe("version_conflict");
      expect(stale.current).toEqual(same);

      await listener.settle();
      expect(
        listener
          .events()
          .filter((event) => event.type === "sprint.changed")
          .map((event) => [event.entityId, event.version]),
      ).toEqual([
        [sprint.id, 2],
        [sprint.id, 3],
        [sprint.id, 4],
      ]);
    } finally {
      await listener.close();
    }
  });

  it("checks the dates as they will be after the change, against the stored ones", async () => {
    const { manager } = await setup();
    const sprint = await createSprint(manager, "OPA", { name: "S", ...DATES });

    const error = await failure(
      updateSprint(manager, sprint.id, { endDate: "2026-11-30", version: 1 }),
    );
    const startAfter = await failure(
      updateSprint(manager, sprint.id, { startDate: "2026-12-20", version: 1 }),
    );

    for (const refused of [error, startAfter]) {
      expect(refused.status).toBe(400);
      expect(refused.errors?.map((field) => field.path)).toEqual(["endDate"]);
    }
    expect(await getSprint(manager, sprint.id)).toMatchObject({ ...DATES, version: 1 });
  });

  it("edits an active sprint, refuses one in a project without sprints, and answers 404", async () => {
    const { manager } = await setup();
    const sprint = await createSprint(manager, "OPA", { name: "S", ...DATES });
    await makeActive(sprint.id);

    expect((await updateSprint(manager, sprint.id, { name: "Now", version: 1 })).name).toBe("Now");
    await getDb().execute(sql`update sprints set state = 'planned', started_at = null`);
    await updateProject(manager, "OPA", { sprintsEnabled: false, version: 2 });
    expect(
      (await failure(updateSprint(manager, sprint.id, { name: "Off", version: 2 }))).code,
    ).toBe("sprints_disabled");
    expect((await failure(updateSprint(manager, UNKNOWN, { name: "X", version: 1 }))).status).toBe(
      404,
    );
  });

  it("rolls back when the audit write fails", async () => {
    const { manager } = await setup();
    const sprint = await createSprint(manager, "OPA", { name: "S", ...DATES });
    const restore = await failAuditFor("sprint.updated");
    try {
      await expect(
        updateSprint(manager, sprint.id, { name: "Lost", version: 1 }),
      ).rejects.toThrow();
    } finally {
      await restore();
    }

    expect(await getSprint(manager, sprint.id)).toMatchObject({ name: "S", version: 1 });
  });
});

describe("a completed sprint (WS-140 test 6)", () => {
  it("cannot be edited: 409 sprint_completed", async () => {
    const { manager } = await setup();
    const sprint = await createSprint(manager, "OPA", { name: "S", ...DATES });
    await makeCompleted(sprint.id);

    expect((await failure(updateSprint(manager, sprint.id, { name: "X", version: 1 }))).code).toBe(
      "sprint_completed",
    );
    expect(await getSprint(manager, sprint.id)).toMatchObject({
      name: "S",
      state: "completed",
      version: 1,
    });
  });
});

describe("deleteSprint (WS-140 test 7)", () => {
  it("deletes a planned sprint, records sprint.deleted and sends sprint.changed with null", async () => {
    const { manager, managerAccount, project } = await setup();
    const sprint = await createSprint(manager, "OPA", { name: "Gone", ...DATES });
    const listener = await listenForEvents();
    try {
      await deleteSprint(manager, sprint.id);

      expect((await failure(getSprint(manager, sprint.id))).status).toBe(404);
      expect(await audits("sprint.deleted")).toMatchObject([
        {
          actorAccountId: managerAccount.id,
          entity: "sprint",
          entityId: sprint.id,
          data: { projectId: project.id, name: "Gone" },
        },
      ]);
      await listener.settle();
      expect(
        listener
          .events()
          .filter((event) => event.type === "sprint.changed")
          .map((event) => [event.entityId, event.version]),
      ).toEqual([[sprint.id, null]]);
    } finally {
      await listener.close();
    }
  });

  it("refuses an active or completed sprint with 409 sprint_not_planned", async () => {
    const { manager } = await setup();
    const active = await createSprint(manager, "OPA", { name: "A", ...DATES });
    const completed = await createSprint(manager, "OPA", { name: "C", ...DATES });
    await makeActive(active.id);
    await makeCompleted(completed.id);

    for (const sprint of [active, completed]) {
      expect((await failure(deleteSprint(manager, sprint.id))).code).toBe("sprint_not_planned");
    }
    expect(await sprintCount()).toBe(2);
    expect((await failure(deleteSprint(manager, UNKNOWN))).status).toBe(404);
  });

  it("still deletes a planned sprint while sprints are off, not in an archived project", async () => {
    const { manager } = await setup();
    const kept = await createSprint(manager, "OPA", { name: "Kept", ...DATES });
    const other = await createSprint(manager, "OPA", { name: "Other", ...DATES });
    await updateProject(manager, "OPA", { sprintsEnabled: false, version: 2 });

    await deleteSprint(manager, kept.id);
    await archiveProject(manager, "OPA");

    expect((await failure(deleteSprint(manager, other.id))).code).toBe("project_archived");
    expect(await sprintCount()).toBe(1);
  });
});

describe("who may write sprints (WS-140 test 8)", () => {
  it("lets a Member, a Viewer and a worker_agent read, and refuses them every write", async () => {
    const { manager, member, viewer } = await setup();
    const sprint = await createSprint(manager, "OPA", { name: "S", ...DATES });
    const worker = await agent(["projects:read", "tasks:read", "tasks:write", "comments:write"]);

    for (const reader of [member, viewer, worker]) {
      expect((await listSprints(reader, "OPA", { limit: 50 })).items).toHaveLength(1);
      expect((await getSprint(reader, sprint.id)).name).toBe("S");
      for (const attempt of [
        () => createSprint(reader, "OPA", { name: "X", ...DATES }),
        () => updateSprint(reader, sprint.id, { name: "X", version: 1 }),
        () => deleteSprint(reader, sprint.id),
      ]) {
        expect((await failure(attempt())).status).toBe(403);
      }
    }
    expect(await sprintCount()).toBe(1);
    expect(await getSprint(manager, sprint.id)).toMatchObject({ name: "S", version: 1 });
  });

  it("refuses reading to an agent without tasks:read", async () => {
    const { manager } = await setup();
    const sprint = await createSprint(manager, "OPA", { name: "S", ...DATES });
    const blind = await agent(["projects:read"]);

    expect((await failure(listSprints(blind, "OPA", { limit: 50 }))).status).toBe(403);
    expect((await failure(getSprint(blind, sprint.id))).status).toBe(403);
  });

  it("keeps an archived project's sprints readable and unchangeable", async () => {
    const { manager, member } = await setup();
    const sprint = await createSprint(manager, "OPA", { name: "S", ...DATES });
    await archiveProject(manager, "OPA");

    expect((await listSprints(member, "OPA", { limit: 50 })).items).toHaveLength(1);
    expect((await failure(updateSprint(manager, sprint.id, { name: "X", version: 1 }))).code).toBe(
      "project_archived",
    );
  });
});

describe("a restricted agent (WS-140 test 9)", () => {
  it("reads its projects' sprints only", async () => {
    const { manager } = await setup();
    const web = await createProject(manager, { key: "WEB", name: "Web" });
    await updateProject(manager, "WEB", { sprintsEnabled: true, version: 1 });
    const theirs = await createSprint(manager, "WEB", { name: "Theirs", ...DATES });
    const ours = await createSprint(manager, "OPA", { name: "Ours", ...DATES });
    const restricted = await agent(["projects:read", "tasks:read"], [web.id]);

    expect((await listSprints(restricted, "WEB", { limit: 50 })).items.map((s) => s.id)).toEqual([
      theirs.id,
    ]);
    expect((await getSprint(restricted, theirs.id)).name).toBe("Theirs");
    expect((await failure(listSprints(restricted, "OPA", { limit: 50 }))).status).toBe(403);
    expect((await failure(getSprint(restricted, ours.id))).status).toBe(403);
    expect((await failure(getSprint(restricted, UNKNOWN))).status).toBe(404);
  });
});

describe("deleteSprint and its tasks (WS-141 test 18)", () => {
  it("makes the sprint's tasks unscheduled, keeping their rank, with history and events", async () => {
    const { manager, managerAccount } = await setup();
    const sprint = await createSprint(manager, "OPA", { name: "Gone", ...DATES });
    const a = await createTask(manager, "OPA", { title: "A", sprintId: sprint.id });
    const b = await createTask(manager, "OPA", { title: "B" });
    const c = await createTask(manager, "OPA", { title: "C", sprintId: sprint.id });
    const gone = await createTask(manager, "OPA", { title: "Deleted", sprintId: sprint.id });
    await deleteTask(manager, gone.key);
    const listener = await listenForEvents();
    try {
      await deleteSprint(manager, sprint.id);

      const page = await listBacklog(manager, "OPA", { limit: 10 });
      expect(page.items.map((task) => [task.key, task.sprint])).toEqual([
        [a.key, null],
        [b.key, null],
        [c.key, null],
      ]);
      const [deleted] = await getDb().execute<{ sprint_id: string | null }>(
        sql`select sprint_id from tasks where id = ${gone.id}`,
      );
      expect(deleted?.sprint_id).toBeNull();
      for (const task of [a, c]) {
        const history = await getDb()
          .select()
          .from(taskEvents)
          .where(eq(taskEvents.taskId, task.id))
          .orderBy(taskEvents.id);
        expect(history.at(-1)).toMatchObject({
          type: "field_changed",
          field: "sprintId",
          oldValue: sprint.id,
          newValue: null,
          actorAccountId: managerAccount.id,
        });
      }
      await listener.settle();
      expect(
        listener
          .events()
          .filter((event) => event.entity === "task")
          .map((event) => [event.type, event.entityId, event.version]),
      ).toEqual([
        ["task.updated", a.id, 2],
        ["task.updated", c.id, 2],
      ]);
      expect((await getTask(manager, a.key)).version).toBe(2);
    } finally {
      await listener.close();
    }
  });
});
