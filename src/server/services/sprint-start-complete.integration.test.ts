// Starting and completing sprints (WS-142 tests 2 to 11 and 14): where the tasks go, the
// refusals, families of sub-tasks, progress, history, events, audit and permissions.
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { positionsBetween } from "@/lib/position";
import { taskListQuerySchema } from "@/lib/schemas/tasks";
import { type Actor, agentActor } from "@/server/auth/actor";
import { createTestAccount, createTestAgent, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { taskEvents } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

import { listColumns } from "./columns";
import { listenForEvents } from "./events-testing";
import { createProject, updateProject } from "./projects";
import {
  completeSprint,
  createSprint,
  getSprint,
  listSprints,
  startSprint,
  updateSprint,
} from "./sprints";
import {
  createTask,
  deleteTask,
  listBacklog,
  listTasks,
  moveTask,
  restoreTask,
  updateTask,
} from "./tasks";

const UNKNOWN = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";
const DATES = { startDate: "2026-12-01", endDate: "2026-12-14" };

async function setup() {
  const manager = testActor(
    await createTestAccount({ name: "Manager", email: "manager@example.com", role: "manager" }),
  );
  const mia = testActor(
    await createTestAccount({ name: "Mia", email: "mia@example.com", role: "member" }),
  );
  await createProject(manager, { key: "OPA", name: "Opanel" });
  await createProject(manager, { key: "WEB", name: "Website" });
  const opa = await updateProject(manager, "OPA", { sprintsEnabled: true, version: 1 });
  await updateProject(manager, "WEB", { sprintsEnabled: true, version: 1 });
  const [todo, doing, done] = (await listColumns(manager, "OPA")).items;
  if (!todo || !doing || !done) throw new Error("no columns");
  const one = await createSprint(manager, "OPA", { name: "Sprint 1", ...DATES });
  const two = await createSprint(manager, "OPA", { name: "Sprint 2", ...DATES });
  const foreign = await createSprint(manager, "WEB", { name: "Web 1", ...DATES });
  return { manager, mia, opa, todo, doing, done, one, two, foreign };
}

/** Makes a sprint completed in the database, with all five frozen values (as WS-140 tests). */
async function setCompleted(sprintId: string) {
  await getDb().execute(sql`
    update sprints set state = 'completed', started_at = now(), completed_at = now(),
      total_points = 0, completed_points = 0, total_tasks = 0, completed_tasks = 0,
      unestimated = 0
    where id = ${sprintId}`);
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

async function placeOf(taskId: string) {
  const [row] = await getDb().execute<{
    column_id: string | null;
    sprint_id: string | null;
    position: string;
  }>(sql`select column_id, sprint_id, position from tasks where id = ${taskId}`);
  if (!row) throw new Error("no task");
  return { columnId: row.column_id, sprintId: row.sprint_id, position: row.position };
}

async function historyOf(taskId: string) {
  return getDb()
    .select()
    .from(taskEvents)
    .where(eq(taskEvents.taskId, taskId))
    .orderBy(taskEvents.id);
}

async function auditOf(action: string) {
  return getDb().execute<{ actor_account_id: string; entity_id: string; data: unknown }>(sql`
    select actor_account_id, entity_id, data from audit_log where action = ${action}
    order by id`);
}

/** Everything start or completion could write, as one value per table. */
async function fingerprint(): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const table of ["tasks", "sprints", "task_events", "audit_log"]) {
    const [row] = await getDb().execute<{ digest: string }>(
      sql`select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) as digest
          from ${sql.identifier(table)} t`,
    );
    result[table] = row?.digest ?? "";
  }
  return result;
}

const board = () => taskListQuerySchema.parse({ limit: 100 });

async function boardKeys(actor: Actor) {
  return (await listTasks(actor, "OPA", board())).items.map((task) => task.key);
}

async function backlogKeys(actor: Actor) {
  return (await listBacklog(actor, "OPA", { limit: 100 })).items.map((task) => task.key);
}

describe("starting a sprint (WS-142 test 2)", () => {
  it("puts its tasks at the bottom of the first column in backlog order, with history, events and audit", async () => {
    const s = await setup();
    // A completed sprint's record already holds the first column's top.
    const zero = await createSprint(s.manager, "OPA", { name: "Sprint 0", ...DATES });
    const record = await createTask(s.mia, "OPA", { title: "Record" });
    await getDb().execute(sql`
      update tasks set column_id = ${s.todo.id}, sprint_id = ${zero.id} where id = ${record.id}`);
    await setCompleted(zero.id);
    const a = await createTask(s.mia, "OPA", { title: "A", sprintId: s.one.id });
    const other = await createTask(s.mia, "OPA", { title: "Other" });
    const b = await createTask(s.mia, "OPA", { title: "B", sprintId: s.one.id });
    const c = await createTask(s.mia, "OPA", { title: "C", sprintId: s.one.id });
    // The backlog's order, not creation, decides: C goes first.
    await moveTask(s.mia, c.key, { columnId: null, beforeTaskId: a.id, version: 1 });

    const listener = await listenForEvents();
    let started;
    try {
      started = await startSprint(s.manager, s.one.id, { version: 1 });
      await listener.settle();

      expect(listener.events().map((e) => [e.type, e.entityId, e.version])).toEqual([
        ["task.moved", c.id, 3],
        ["task.moved", a.id, 2],
        ["task.moved", b.id, 2],
        ["sprint.changed", s.one.id, 2],
      ]);
    } finally {
      await listener.close();
    }

    expect(started).toMatchObject({ id: s.one.id, state: "active", version: 2 });
    expect(started.startedAt).not.toBeNull();
    expect(started.completedAt).toBeNull();
    expect(await boardKeys(s.mia)).toEqual([c.key, a.key, b.key]);
    expect(await backlogKeys(s.mia)).toEqual([other.key]);
    const recordPlace = await placeOf(record.id);
    for (const task of [a, b, c]) {
      const place = await placeOf(task.id);
      expect(place.columnId).toBe(s.todo.id);
      expect(place.sprintId).toBe(s.one.id);
      expect(place.position > recordPlace.position).toBe(true);
      expect(
        (await historyOf(task.id))
          .slice(-1)
          .map((e) => [e.type, e.oldValue, e.newValue, e.actorAccountId]),
      ).toEqual([["moved", { columnId: null }, { columnId: s.todo.id }, s.manager.accountId]]);
    }
    expect(await auditOf("sprint.started")).toEqual([
      {
        actor_account_id: s.manager.accountId,
        entity_id: s.one.id,
        data: { projectId: s.opa.id, name: "Sprint 1", tasks: 3 },
      },
    ]);
  });
});

describe("start refusals (WS-142 test 3)", () => {
  it("refuses another active sprint, a sprint not planned, sprints off and a stale version, writing nothing", async () => {
    const s = await setup();
    await createTask(s.mia, "OPA", { title: "A", sprintId: s.two.id });
    await startSprint(s.manager, s.one.id, { version: 1 });
    const before = await fingerprint();

    const active = await failure(startSprint(s.manager, s.two.id, { version: 1 }));
    expect([active.status, active.code]).toEqual([409, "sprint_active"]);
    const again = await failure(startSprint(s.manager, s.one.id, { version: 2 }));
    expect([again.status, again.code]).toEqual([409, "sprint_not_planned"]);
    const stale = await failure(startSprint(s.manager, s.two.id, { version: 7 }));
    // A stale version on a sprint that could otherwise not start still names the reason.
    expect([stale.status, stale.code]).toEqual([409, "sprint_active"]);
    expect(await fingerprint()).toEqual(before);

    await setCompleted(s.one.id);
    const conflict = await failure(startSprint(s.manager, s.two.id, { version: 7 }));
    expect([conflict.status, conflict.code]).toEqual([409, "version_conflict"]);
    expect(conflict).toMatchObject({ current: { id: s.two.id, version: 1 } });

    await updateProject(s.manager, "OPA", { sprintsEnabled: false, version: s.opa.version });
    const off = await failure(startSprint(s.manager, s.two.id, { version: 1 }));
    expect([off.status, off.code]).toEqual([409, "sprints_disabled"]);
    expect((await getSprint(s.manager, s.two.id)).state).toBe("planned");
  });

  it("runs beside a task write to the same sprint, and the rule holds either way", async () => {
    const s = await setup();
    await createTask(s.mia, "OPA", { title: "A", sprintId: s.one.id });
    const joining = await createTask(s.mia, "OPA", { title: "Joining" });

    await Promise.all([
      startSprint(s.manager, s.one.id, { version: 1 }),
      updateTask(s.mia, joining.key, { sprintId: s.one.id, version: 1 }),
    ]);

    expect(await placeOf(joining.id)).toMatchObject({ columnId: s.todo.id, sprintId: s.one.id });
  });
});

describe("starting an empty sprint, and deleted tasks (WS-142 test 4)", () => {
  it("starts a sprint with no task", async () => {
    const s = await setup();

    const started = await startSprint(s.manager, s.one.id, { version: 1 });

    expect(started.state).toBe("active");
    expect(await boardKeys(s.mia)).toEqual([]);
    expect((await auditOf("sprint.started"))[0]?.data).toEqual({
      projectId: s.opa.id,
      name: "Sprint 1",
      tasks: 0,
    });
  });

  it("leaves a deleted task without a column, and its restore follows the rule", async () => {
    const s = await setup();
    const gone = await createTask(s.mia, "OPA", { title: "Gone", sprintId: s.one.id });
    await deleteTask(s.mia, gone.key);

    await startSprint(s.manager, s.one.id, { version: 1 });
    expect(await placeOf(gone.id)).toMatchObject({ columnId: null, sprintId: s.one.id });

    const restored = await restoreTask(s.mia, gone.key);
    expect(restored.columnId).toBeNull();
    expect(restored.sprint).toBeNull();
  });
});

/** Sprint 1 started with A, B, C, D (backlog order); B done, D in progress, C first in To do. */
async function activeSprint() {
  const s = await setup();
  const a = await createTask(s.mia, "OPA", { title: "A", sprintId: s.one.id, storyPoints: 3 });
  const b = await createTask(s.mia, "OPA", { title: "B", sprintId: s.one.id, storyPoints: 2 });
  const c = await createTask(s.mia, "OPA", { title: "C", sprintId: s.one.id });
  const d = await createTask(s.mia, "OPA", { title: "D", sprintId: s.one.id, storyPoints: 1 });
  const waiting = await createTask(s.mia, "OPA", { title: "Waiting" });
  const next = await createTask(s.mia, "OPA", { title: "Next", sprintId: s.two.id });
  await startSprint(s.manager, s.one.id, { version: 1 });
  await moveTask(s.mia, b.key, { columnId: s.done.id, version: 2 });
  await moveTask(s.mia, d.key, { columnId: s.doing.id, version: 2 });
  await moveTask(s.mia, c.key, { columnId: s.todo.id, beforeTaskId: a.id, version: 2 });
  return { ...s, a, b, c, d, waiting, next };
}

describe("completing into a planned sprint (WS-142 test 5)", () => {
  it("keeps done work in its column and sends the rest to the top of the backlog, in board order", async () => {
    const s = await activeSprint();

    const completed = await completeSprint(s.manager, s.one.id, {
      moveUnfinishedTo: s.two.id,
      version: 2,
    });

    expect(completed).toMatchObject({ id: s.one.id, state: "completed", version: 3 });
    expect(completed.completedAt).not.toBeNull();
    expect(completed.unfinishedSubtasksKept).toBe(0);
    expect(await placeOf(s.b.id)).toMatchObject({ columnId: s.done.id, sprintId: s.one.id });
    for (const task of [s.a, s.c, s.d]) {
      expect(await placeOf(task.id)).toMatchObject({ columnId: null, sprintId: s.two.id });
    }
    // To do (C, A), then In progress (D), above what the backlog held.
    expect(await backlogKeys(s.mia)).toEqual([s.c.key, s.a.key, s.d.key, s.waiting.key, s.next.key]);
    expect(await boardKeys(s.mia)).toEqual([]);
    expect(
      (await historyOf(s.d.id))
        .slice(-2)
        .map((e) => [e.type, e.field, e.oldValue, e.newValue, e.actorAccountId]),
    ).toEqual([
      ["moved", null, { columnId: s.doing.id }, { columnId: null }, s.manager.accountId],
      ["field_changed", "sprintId", s.one.id, s.two.id, s.manager.accountId],
    ]);
    expect(await auditOf("sprint.completed")).toEqual([
      {
        actor_account_id: s.manager.accountId,
        entity_id: s.one.id,
        data: { projectId: s.opa.id, name: "Sprint 1", moveUnfinishedTo: s.two.id, moved: 3 },
      },
    ]);
  });
});

describe("completing into the backlog (WS-142 test 6)", () => {
  it("unschedules the unfinished at the top of the backlog, in board order", async () => {
    const s = await activeSprint();

    await completeSprint(s.manager, s.one.id, { moveUnfinishedTo: null, version: 2 });

    for (const task of [s.a, s.c, s.d]) {
      expect(await placeOf(task.id)).toMatchObject({ columnId: null, sprintId: null });
    }
    expect(await backlogKeys(s.mia)).toEqual([s.c.key, s.a.key, s.d.key, s.waiting.key, s.next.key]);
    expect((await auditOf("sprint.completed"))[0]?.data).toMatchObject({
      moveUnfinishedTo: null,
      moved: 3,
    });
  });
});

/** Sprint 1 with two families: P1 done (one sub-task unfinished), P2 unfinished (one done). */
async function families() {
  const s = await setup();
  const p1 = await createTask(s.mia, "OPA", { title: "P1", sprintId: s.one.id });
  const p1open = await createTask(s.mia, "OPA", { title: "P1 open", parentId: p1.key });
  const p1done = await createTask(s.mia, "OPA", { title: "P1 done", parentId: p1.key });
  const p2 = await createTask(s.mia, "OPA", { title: "P2", sprintId: s.one.id });
  const p2done = await createTask(s.mia, "OPA", { title: "P2 done", parentId: p2.key });
  const p2open = await createTask(s.mia, "OPA", { title: "P2 open", parentId: p2.key });
  await startSprint(s.manager, s.one.id, { version: 1 });
  await moveTask(s.mia, p1.key, { columnId: s.done.id, version: 2 });
  await moveTask(s.mia, p1done.key, { columnId: s.done.id, version: 2 });
  await moveTask(s.mia, p2done.key, { columnId: s.done.id, version: 2 });
  return { ...s, p1, p1open, p1done, p2, p2done, p2open };
}

describe("families at completion (WS-142 test 7)", () => {
  it("keeps a done parent's unfinished sub-task, and an unfinished parent takes its done ones", async () => {
    const s = await families();

    const completed = await completeSprint(s.manager, s.one.id, {
      moveUnfinishedTo: null,
      version: 2,
    });

    expect(completed.unfinishedSubtasksKept).toBe(1);
    expect(await placeOf(s.p1.id)).toMatchObject({ columnId: s.done.id, sprintId: s.one.id });
    expect(await placeOf(s.p1done.id)).toMatchObject({ columnId: s.done.id, sprintId: s.one.id });
    expect(await placeOf(s.p1open.id)).toMatchObject({ columnId: s.todo.id, sprintId: s.one.id });
    for (const task of [s.p2, s.p2done, s.p2open]) {
      expect(await placeOf(task.id)).toMatchObject({ columnId: null, sprintId: null });
    }
    // The head first, then its sub-tasks in board order: To do before Done.
    expect(await backlogKeys(s.mia)).toEqual([s.p2.key, s.p2open.key, s.p2done.key]);
    expect((await auditOf("sprint.completed"))[0]?.data).toMatchObject({ moved: 3 });
  });

  it("moves a family into a planned sprint together", async () => {
    const s = await families();

    await completeSprint(s.manager, s.one.id, { moveUnfinishedTo: s.two.id, version: 2 });

    for (const task of [s.p2, s.p2done, s.p2open]) {
      expect(await placeOf(task.id)).toMatchObject({ columnId: null, sprintId: s.two.id });
    }
  });
});

describe("complete refusals (WS-142 test 8)", () => {
  it("refuses a sprint not active, a bad target, sprints off and a stale version, writing nothing", async () => {
    const s = await activeSprint();
    const zero = await createSprint(s.manager, "OPA", { name: "Sprint 0", ...DATES });
    await setCompleted(zero.id);
    const before = await fingerprint();

    const planned = await failure(
      completeSprint(s.manager, s.two.id, { moveUnfinishedTo: null, version: 1 }),
    );
    expect([planned.status, planned.code]).toEqual([409, "sprint_not_active"]);
    const record = await failure(
      completeSprint(s.manager, zero.id, { moveUnfinishedTo: null, version: 1 }),
    );
    expect([record.status, record.code]).toEqual([409, "sprint_not_active"]);

    for (const target of [zero.id, s.one.id, s.foreign.id, UNKNOWN]) {
      const error = await failure(
        completeSprint(s.manager, s.one.id, { moveUnfinishedTo: target, version: 2 }),
      );
      expect([error.status, error.errors?.[0]?.path]).toEqual([400, "moveUnfinishedTo"]);
    }

    const stale = await failure(
      completeSprint(s.manager, s.one.id, { moveUnfinishedTo: null, version: 1 }),
    );
    expect([stale.status, stale.code]).toEqual([409, "version_conflict"]);
    expect(stale).toMatchObject({ current: { id: s.one.id, version: 2 } });

    await getDb().execute(sql`update projects set sprints_enabled = false where id = ${s.opa.id}`);
    const off = await failure(
      completeSprint(s.manager, s.one.id, { moveUnfinishedTo: null, version: 2 }),
    );
    expect([off.status, off.code]).toEqual([409, "sprints_disabled"]);
    await getDb().execute(sql`update projects set sprints_enabled = true where id = ${s.opa.id}`);

    expect(await fingerprint()).toEqual(before);
  });

  it("runs beside a task write to the same sprint, and the rule holds either way", async () => {
    const s = await activeSprint();

    const [completed, moved] = await Promise.allSettled([
      completeSprint(s.manager, s.one.id, { moveUnfinishedTo: null, version: 2 }),
      moveTask(s.mia, s.a.key, { columnId: s.doing.id, version: 2 }),
    ]);

    expect(completed.status).toBe("fulfilled");
    if (moved.status === "rejected") {
      expect(moved.reason).toMatchObject({ code: "no_active_sprint" });
    }
    expect(await placeOf(s.a.id)).toMatchObject({ columnId: null, sprintId: null });
  });
});

describe("progress (WS-142 test 9)", () => {
  it("is computed live for planned and active sprints, sub-tasks and points counted", async () => {
    const s = await setup();
    const parent = await createTask(s.mia, "OPA", {
      title: "P",
      sprintId: s.two.id,
      storyPoints: 3,
    });
    await createTask(s.mia, "OPA", { title: "S", parentId: parent.key, storyPoints: 2.5 });
    await createTask(s.mia, "OPA", { title: "None", sprintId: s.two.id });
    const gone = await createTask(s.mia, "OPA", { title: "Gone", sprintId: s.two.id });
    await deleteTask(s.mia, gone.key);

    expect((await getSprint(s.mia, s.two.id)).progress).toEqual({
      doneTasks: 0,
      totalTasks: 3,
      donePoints: 0,
      totalPoints: 5.5,
      unestimated: 1,
    });
    expect((await getSprint(s.mia, s.one.id)).progress).toEqual({
      doneTasks: 0,
      totalTasks: 0,
      donePoints: 0,
      totalPoints: 0,
      unestimated: 0,
    });

    await startSprint(s.manager, s.two.id, { version: 1 });
    await moveTask(s.mia, parent.key, { columnId: s.done.id, version: 2 });
    const page = await listSprints(s.mia, "OPA", { limit: 50 });
    expect(page.items.find((sprint) => sprint.id === s.two.id)?.progress).toEqual({
      doneTasks: 1,
      totalTasks: 3,
      donePoints: 3,
      totalPoints: 5.5,
      unestimated: 1,
    });
  });

  it("is frozen at completion, unchanged after its tasks move or change points", async () => {
    const s = await activeSprint();
    const frozen = {
      doneTasks: 1,
      totalTasks: 4,
      donePoints: 2,
      totalPoints: 6,
      unestimated: 1,
    };
    expect((await getSprint(s.mia, s.one.id)).progress).toEqual(frozen);

    const completed = await completeSprint(s.manager, s.one.id, {
      moveUnfinishedTo: s.two.id,
      version: 2,
    });
    expect(completed.progress).toEqual(frozen);

    await updateTask(s.mia, s.b.key, { storyPoints: 8, version: 3 });
    await updateTask(s.mia, s.a.key, { storyPoints: 13, version: 3 });
    await startSprint(s.manager, s.two.id, { version: 1 });
    await moveTask(s.mia, s.a.key, { columnId: s.done.id, version: 5 });

    expect((await getSprint(s.mia, s.one.id)).progress).toEqual(frozen);
    expect(
      (await listSprints(s.mia, "OPA", { limit: 50 })).items.find(
        (sprint) => sprint.id === s.one.id,
      )?.progress,
    ).toEqual(frozen);
  });
});

describe("events of a completion (WS-142 test 10)", () => {
  it("sends task.moved per moved task, the parent's task.updated, and sprint.changed for both sprints", async () => {
    const s = await families();
    const listener = await listenForEvents();
    try {
      await completeSprint(s.manager, s.one.id, { moveUnfinishedTo: s.two.id, version: 2 });
      await listener.settle();

      expect(listener.events().map((e) => [e.type, e.entityId, e.version])).toEqual([
        ["task.moved", s.p2.id, 3],
        ["task.moved", s.p2open.id, 3],
        ["task.moved", s.p2done.id, 4],
        ["task.updated", s.p2.id, 3],
        ["sprint.changed", s.one.id, 3],
        ["sprint.changed", s.two.id, 1],
      ]);
    } finally {
      await listener.close();
    }
  });

  it("sends sprint.changed for the completed sprint only, into the backlog", async () => {
    const s = await setup();
    await startSprint(s.manager, s.one.id, { version: 1 });
    const listener = await listenForEvents();
    try {
      await completeSprint(s.manager, s.one.id, { moveUnfinishedTo: null, version: 2 });
      await listener.settle();

      expect(listener.events().map((e) => [e.type, e.entityId, e.version])).toEqual([
        ["sprint.changed", s.one.id, 3],
      ]);
    } finally {
      await listener.close();
    }
  });
});

describe("who may start and complete (WS-142 test 11)", () => {
  it("refuses a Member, a Viewer and a worker_agent (403)", async () => {
    const s = await setup();
    const viewer = testActor(await createTestAccount({ email: "vic@example.com", role: "viewer" }));
    const scopes = ["projects:read", "tasks:read", "tasks:write", "reports:write"] as const;
    const worker = await createTestAgent({ name: "W", role: "worker_agent", scopes: [...scopes] });
    const agent = agentActor({
      accountId: worker.id,
      role: "worker_agent",
      scopes,
      projectIds: null,
    });
    await startSprint(s.manager, s.one.id, { version: 1 });
    const before = await fingerprint();

    for (const actor of [s.mia, viewer, agent]) {
      const start = await failure(startSprint(actor, s.two.id, { version: 1 }));
      expect(start.status).toBe(403);
      const complete = await failure(
        completeSprint(actor, s.one.id, { moveUnfinishedTo: null, version: 2 }),
      );
      expect(complete.status).toBe(403);
    }
    expect(await fingerprint()).toEqual(before);
  });
});

describe("a 500-task sprint (WS-142 test 14)", () => {
  it("starts and completes, and the time is recorded", async () => {
    const s = await setup();
    const keys = positionsBetween(null, null, 500);
    await getDb().execute(sql`
      insert into tasks (project_id, number, type, title, position, sprint_id, story_points,
        reporter_account_id)
      select ${s.opa.id}, 1000 + n, 'task', 'Task ' || n, ${JSON.stringify(keys)}::jsonb ->> (n - 1), ${s.one.id}, 1,
        ${s.manager.accountId}
      from generate_series(1, 500) as n`);

    const startedAt = performance.now();
    await startSprint(s.manager, s.one.id, { version: 1 });
    const startMs = performance.now() - startedAt;
    await getDb().execute(sql`
      update tasks set column_id = ${s.done.id}
      where sprint_id = ${s.one.id} and number % 2 = 0`);
    const completedAt = performance.now();
    const completed = await completeSprint(s.manager, s.one.id, {
      moveUnfinishedTo: s.two.id,
      version: 2,
    });
    const completeMs = performance.now() - completedAt;
    console.info(
      `WS-142 test 14: start ${startMs.toFixed(0)} ms, complete ${completeMs.toFixed(0)} ms`,
    );

    expect(completed.progress).toEqual({
      doneTasks: 250,
      totalTasks: 500,
      donePoints: 250,
      totalPoints: 500,
      unestimated: 0,
    });
    const [counts] = await getDb().execute<{ kept: number; moved: number }>(sql`
      select (count(*) filter (where sprint_id = ${s.one.id}))::int as kept,
        (count(*) filter (where sprint_id = ${s.two.id} and column_id is null))::int as moved
      from tasks where project_id = ${s.opa.id}`);
    expect(counts).toEqual({ kept: 250, moved: 250 });
  });
});

describe("a planned sprint's edit after the start (WS-142 section 4)", () => {
  it("keeps the dates as they were, editable afterwards", async () => {
    const s = await setup();
    const started = await startSprint(s.manager, s.one.id, { version: 1 });
    expect([started.startDate, started.endDate]).toEqual([DATES.startDate, DATES.endDate]);

    const edited = await updateSprint(s.manager, s.one.id, { endDate: "2026-12-20", version: 2 });
    expect(edited.endDate).toBe("2026-12-20");
  });
});
