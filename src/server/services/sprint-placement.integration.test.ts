// Where a task goes in a project with sprints, and without (WS-141 tests 2 to 10): create,
// move, edit, sub-tasks, restore, the setting turned off, and the active sprint's lock.
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { moveTaskRequestSchema } from "@/lib/schemas/tasks";
import { createTestAccount, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { taskEvents } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

import { listColumns } from "./columns";
import { listenForEvents } from "./events-testing";
import { createProject, updateProject } from "./projects";
import { createSprint } from "./sprints";
import {
  createTask,
  deleteTask,
  getTask,
  listBacklog,
  moveTask,
  restoreTask,
  updateTask,
} from "./tasks";

const UNKNOWN = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";
const DATES = { startDate: "2026-12-01", endDate: "2026-12-14" };

/** Item D starts and completes sprints; until then a test sets the state in the database. */
async function setState(sprintId: string, state: "planned" | "active" | "completed") {
  await getDb().execute(sql`
    update sprints set state = ${state},
      started_at = ${state === "planned" ? null : sql`now()`},
      completed_at = ${state === "completed" ? sql`now()` : null},
      total_points = ${state === "completed" ? 0 : null},
      completed_points = ${state === "completed" ? 0 : null}
    where id = ${sprintId}`);
}

async function setup({ sprints = true, active = true } = {}) {
  const manager = testActor(
    await createTestAccount({ name: "Manager", email: "manager@example.com", role: "manager" }),
  );
  const mia = testActor(
    await createTestAccount({ name: "Mia", email: "mia@example.com", role: "member" }),
  );
  await createProject(manager, { key: "OPA", name: "Opanel" });
  await createProject(manager, { key: "WEB", name: "Website" });
  await updateProject(manager, "OPA", { sprintsEnabled: true, version: 1 });
  await updateProject(manager, "WEB", { sprintsEnabled: true, version: 1 });
  const [todo, doing, done] = (await listColumns(manager, "OPA")).items;
  if (!todo || !doing || !done) throw new Error("no columns");
  const sprint1 = await createSprint(manager, "OPA", { name: "Sprint 1", ...DATES });
  const sprint2 = await createSprint(manager, "OPA", { name: "Sprint 2", ...DATES });
  const foreign = await createSprint(manager, "WEB", { name: "Web 1", ...DATES });
  if (active && sprints) await setState(sprint1.id, "active");
  if (!sprints) await updateProject(manager, "OPA", { sprintsEnabled: false, version: 2 });
  return { manager, mia, todo, doing, done, active: sprint1, planned: sprint2, foreign };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected a failure");
}

function fieldFailure(error: ApiError) {
  return [error.status, error.code, error.errors?.map((e) => e.path)];
}

async function historyOf(taskId: string) {
  return getDb()
    .select()
    .from(taskEvents)
    .where(eq(taskEvents.taskId, taskId))
    .orderBy(taskEvents.id);
}

async function backlogKeys(s: Setup): Promise<string[]> {
  return (await listBacklog(s.manager, "OPA", { limit: 100 })).items.map((task) => task.key);
}

async function columnKeys(columnId: string): Promise<string[]> {
  const rows = await getDb().execute<{ key: string }>(sql`
    select 'OPA-' || number as key from tasks
    where column_id = ${columnId} and deleted_at is null order by position collate "C"`);
  return rows.map((row) => row.key);
}

/** Puts a task in a sprint and a column straight in the database, for a starting state. */
async function place(taskId: string, sprintId: string | null, columnId: string | null) {
  await getDb().execute(
    sql`update tasks set sprint_id = ${sprintId}, column_id = ${columnId} where id = ${taskId}`,
  );
}

function ref(sprint: { id: string; name: string }, state: string) {
  return { id: sprint.id, name: sprint.name, state };
}

describe("createTask in sprints (WS-141 test 2)", () => {
  it("joins the active sprint when created in a column", async () => {
    const s = await setup();
    const task = await createTask(s.mia, "OPA", { title: "Board", columnId: s.doing.id });

    expect(task.columnId).toBe(s.doing.id);
    expect(task.sprint).toEqual(ref(s.active, "active"));
    const [created] = await historyOf(task.id);
    expect(created?.newValue).toMatchObject({ columnId: s.doing.id, sprintId: s.active.id });
  });

  it("refuses a column with no active sprint (409 no_active_sprint)", async () => {
    const s = await setup({ active: false });
    const error = await failure(createTask(s.mia, "OPA", { title: "X", columnId: s.todo.id }));

    expect([error.status, error.code]).toEqual([409, "no_active_sprint"]);
  });

  it("goes to the end of the backlog, unscheduled, without a column", async () => {
    const s = await setup({ active: false });
    const first = await createTask(s.mia, "OPA", { title: "First" });
    const second = await createTask(s.mia, "OPA", { title: "Second" });

    expect([first.columnId, first.sprint, second.columnId, second.sprint]).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(await backlogKeys(s)).toEqual([first.key, second.key]);
  });

  it("keeps today's default, the first column, in a project without sprints", async () => {
    const s = await setup({ sprints: false });
    const task = await createTask(s.mia, "OPA", { title: "Board" });

    expect([task.columnId, task.sprint]).toEqual([s.todo.id, null]);
  });
});

describe("createTask with sprintId (WS-141 test 3)", () => {
  it("puts a task of the active sprint at the bottom of the first column", async () => {
    const s = await setup();
    const before = await createTask(s.mia, "OPA", { title: "Before", columnId: s.todo.id });
    const task = await createTask(s.mia, "OPA", { title: "Active", sprintId: s.active.id });

    expect([task.columnId, task.sprint]).toEqual([s.todo.id, ref(s.active, "active")]);
    expect(await columnKeys(s.todo.id)).toEqual([before.key, task.key]);
  });

  it("puts a task of a planned sprint at the end of the backlog", async () => {
    const s = await setup();
    const unscheduled = await createTask(s.mia, "OPA", { title: "Unscheduled" });
    const task = await createTask(s.mia, "OPA", { title: "Planned", sprintId: s.planned.id });

    expect([task.columnId, task.sprint]).toEqual([null, ref(s.planned, "planned")]);
    expect(await backlogKeys(s)).toEqual([unscheduled.key, task.key]);
  });

  it("accepts a column and the active sprint, or null and a planned sprint or none", async () => {
    const s = await setup();
    const both = await createTask(s.mia, "OPA", {
      title: "Both",
      columnId: s.doing.id,
      sprintId: s.active.id,
    });
    const planned = await createTask(s.mia, "OPA", {
      title: "Planned",
      columnId: null,
      sprintId: s.planned.id,
    });
    const none = await createTask(s.mia, "OPA", { title: "None", columnId: null, sprintId: null });

    expect([both.columnId, both.sprint?.id]).toEqual([s.doing.id, s.active.id]);
    expect([planned.columnId, planned.sprint?.id]).toEqual([null, s.planned.id]);
    expect([none.columnId, none.sprint]).toEqual([null, null]);
  });

  it("refuses a completed, foreign or unknown sprint, and a column that disagrees (400)", async () => {
    const s = await setup();
    await setState(s.planned.id, "completed");
    const third = await createSprint(s.manager, "OPA", { name: "Sprint 3", ...DATES });

    for (const input of [
      { sprintId: s.planned.id },
      { sprintId: s.foreign.id },
      { sprintId: UNKNOWN },
      { sprintId: third.id, columnId: s.todo.id },
      { sprintId: s.active.id, columnId: null },
      { sprintId: null, columnId: s.todo.id },
    ]) {
      const error = await failure(createTask(s.mia, "OPA", { title: "X", ...input }));
      expect(fieldFailure(error), JSON.stringify(input)).toEqual([
        400,
        "invalid_request",
        ["sprintId"],
      ]);
    }
    const completed = await failure(
      createTask(s.mia, "OPA", { title: "X", sprintId: s.planned.id }),
    );
    expect(completed.errors).toEqual([
      { path: "sprintId", message: "Not a planned or active sprint." },
    ]);
  });
});

describe("moveTask in sprints (WS-141 test 4)", () => {
  it("joins the active sprint when moved onto the board, with both entries", async () => {
    const s = await setup();
    const task = await createTask(s.mia, "OPA", { title: "Backlog" });
    const moved = await moveTask(s.mia, task.key, { columnId: s.doing.id, version: 1 });

    expect([moved.columnId, moved.sprint]).toEqual([s.doing.id, ref(s.active, "active")]);
    const history = (await historyOf(task.id)).slice(1);
    expect(history.map((e) => [e.type, e.field, e.oldValue, e.newValue, e.actorAccountId])).toEqual(
      [
        ["moved", null, { columnId: null }, { columnId: s.doing.id }, s.mia.accountId],
        ["field_changed", "sprintId", null, s.active.id, s.mia.accountId],
      ],
    );

    // Between columns of the active sprint: no sprint entry.
    await moveTask(s.mia, task.key, { columnId: s.done.id, version: moved.version });
    expect((await historyOf(task.id)).slice(3).map((e) => e.type)).toEqual(["moved"]);
  });

  it("leaves the sprint when moved to the backlog", async () => {
    const s = await setup();
    const task = await createTask(s.mia, "OPA", { title: "Board", columnId: s.todo.id });
    const moved = await moveTask(s.mia, task.key, { columnId: null, version: 1 });

    expect([moved.columnId, moved.sprint]).toEqual([null, null]);
    expect((await historyOf(task.id)).at(-1)).toMatchObject({
      type: "field_changed",
      field: "sprintId",
      oldValue: s.active.id,
      newValue: null,
    });
  });

  it("refuses a column with no active sprint (409 no_active_sprint)", async () => {
    const s = await setup({ active: false });
    const task = await createTask(s.mia, "OPA", { title: "Backlog" });
    const error = await failure(moveTask(s.mia, task.key, { columnId: s.todo.id, version: 1 }));

    expect([error.status, error.code]).toEqual([409, "no_active_sprint"]);
  });

  it("takes sprintId on a backlog move: a planned sprint or null, at the place asked", async () => {
    const s = await setup();
    const a = await createTask(s.mia, "OPA", { title: "A" });
    const b = await createTask(s.mia, "OPA", { title: "B", sprintId: s.planned.id });
    const c = await createTask(s.mia, "OPA", { title: "C" });

    const planned = await moveTask(s.mia, c.key, {
      columnId: null,
      sprintId: s.planned.id,
      afterTaskId: a.id,
      version: 1,
    });
    expect(planned.sprint).toEqual(ref(s.planned, "planned"));
    expect(await backlogKeys(s)).toEqual([a.key, c.key, b.key]);

    // Omitted, a backlog task keeps its planned sprint (deviation A); null unschedules it.
    const kept = await moveTask(s.mia, b.key, { columnId: null, beforeTaskId: a.id, version: 1 });
    expect(kept.sprint?.id).toBe(s.planned.id);
    expect(await backlogKeys(s)).toEqual([b.key, a.key, c.key]);
    const cleared = await moveTask(s.mia, b.key, {
      columnId: null,
      sprintId: null,
      version: kept.version,
    });
    expect(cleared.sprint).toBeNull();
    expect((await historyOf(b.id)).at(-1)).toMatchObject({
      field: "sprintId",
      oldValue: s.planned.id,
      newValue: null,
    });
  });

  it("refuses sprintId with a column, and a sprint that is not planned (400)", async () => {
    const s = await setup();
    const task = await createTask(s.mia, "OPA", { title: "Backlog" });

    const withColumn = moveTaskRequestSchema.safeParse({
      columnId: s.todo.id,
      sprintId: s.planned.id,
      version: 1,
    });
    expect(withColumn.error?.issues.map((issue) => issue.path)).toEqual([["sprintId"]]);
    for (const sprintId of [s.active.id, s.foreign.id, UNKNOWN]) {
      const error = await failure(
        moveTask(s.mia, task.key, { columnId: null, sprintId, version: 1 }),
      );
      expect(fieldFailure(error)).toEqual([400, "invalid_request", ["sprintId"]]);
    }
  });
});

describe("updateTask sprintId (WS-141 test 5)", () => {
  it("to the active sprint: the bottom of the first column, sent as task.moved", async () => {
    const s = await setup();
    const there = await createTask(s.mia, "OPA", { title: "There", columnId: s.todo.id });
    const task = await createTask(s.mia, "OPA", { title: "Backlog" });
    const listener = await listenForEvents();
    try {
      const updated = await updateTask(s.mia, task.key, { sprintId: s.active.id, version: 1 });

      expect([updated.columnId, updated.sprint?.id]).toEqual([s.todo.id, s.active.id]);
      expect(await columnKeys(s.todo.id)).toEqual([there.key, task.key]);
      await listener.settle();
      expect(
        listener
          .events()
          .filter((e) => e.entityId === task.id)
          .map((e) => e.type),
      ).toEqual(["task.moved"]);
      expect((await historyOf(task.id)).slice(1).map((e) => [e.type, e.field])).toEqual([
        ["field_changed", "sprintId"],
        ["moved", null],
      ]);
    } finally {
      await listener.close();
    }
  });

  it("to a planned sprint or null: the end of the backlog, or its rank kept", async () => {
    const s = await setup();
    const board = await createTask(s.mia, "OPA", { title: "Board", columnId: s.doing.id });
    const a = await createTask(s.mia, "OPA", { title: "A" });
    const b = await createTask(s.mia, "OPA", { title: "B", sprintId: s.planned.id });
    const c = await createTask(s.mia, "OPA", { title: "C" });

    const planned = await updateTask(s.mia, board.key, { sprintId: s.planned.id, version: 1 });
    expect([planned.columnId, planned.sprint?.id]).toEqual([null, s.planned.id]);
    expect(await backlogKeys(s)).toEqual([a.key, b.key, c.key, board.key]);

    const cleared = await updateTask(s.mia, b.key, { sprintId: null, version: 1 });
    expect([cleared.columnId, cleared.sprint]).toEqual([null, null]);
    expect(await backlogKeys(s)).toEqual([a.key, b.key, c.key, board.key]);
  });
});

describe("a completed sprint's task (WS-141 test 6)", () => {
  it("cannot be given another sprint (409 sprint_completed)", async () => {
    const s = await setup();
    const task = await createTask(s.mia, "OPA", { title: "Done", columnId: s.done.id });
    await setState(s.active.id, "completed");

    for (const sprintId of [s.planned.id, null]) {
      const error = await failure(updateTask(s.mia, task.key, { sprintId, version: 1 }));
      expect([error.status, error.code]).toEqual([409, "sprint_completed"]);
    }
  });

  it("leaves the record when moved, into the active sprint or the backlog", async () => {
    const s = await setup({ active: false });
    const one = await createTask(s.mia, "OPA", { title: "One" });
    const two = await createTask(s.mia, "OPA", { title: "Two" });
    await place(one.id, s.active.id, s.done.id);
    await place(two.id, s.active.id, s.done.id);
    await setState(s.active.id, "completed");
    await setState(s.planned.id, "active");

    const reopened = await moveTask(s.mia, one.key, { columnId: s.todo.id, version: 1 });
    expect(reopened.sprint).toEqual(ref(s.planned, "active"));
    const backlog = await moveTask(s.mia, two.key, { columnId: null, version: 1 });
    expect([backlog.columnId, backlog.sprint]).toEqual([null, null]);
  });
});

describe("sub-tasks follow their parent's sprint (WS-141 test 7)", () => {
  it("copies the parent's sprint on create, and places the sub-task by it", async () => {
    const s = await setup();
    const active = await createTask(s.mia, "OPA", { title: "Active", columnId: s.doing.id });
    const planned = await createTask(s.mia, "OPA", { title: "Planned", sprintId: s.planned.id });

    const onBoard = await createTask(s.mia, "OPA", { title: "Sub", parentId: active.key });
    expect([onBoard.columnId, onBoard.sprint?.id]).toEqual([s.todo.id, s.active.id]);
    const inBacklog = await createTask(s.mia, "OPA", { title: "Sub", parentId: planned.key });
    expect([inBacklog.columnId, inBacklog.sprint?.id]).toEqual([null, s.planned.id]);
    const same = await createTask(s.mia, "OPA", {
      title: "Same",
      parentId: planned.key,
      sprintId: s.planned.id,
    });
    expect(same.sprint?.id).toBe(s.planned.id);

    const differing = await failure(
      createTask(s.mia, "OPA", { title: "X", parentId: planned.key, sprintId: null }),
    );
    expect(differing.errors).toEqual([
      { path: "sprintId", message: "A sub-task's sprint is its parent's." },
    ]);
    for (const [parent, columnId] of [
      [active.key, null],
      [planned.key, s.todo.id],
    ] as const) {
      const error = await failure(
        createTask(s.mia, "OPA", { title: "X", parentId: parent, columnId }),
      );
      expect([error.status, error.code]).toEqual([409, "subtask_follows_parent"]);
    }
  });

  it("copies the parent's sprint on attach; clearing the parent keeps it", async () => {
    const s = await setup();
    const active = await createTask(s.mia, "OPA", { title: "Active", columnId: s.doing.id });
    const planned = await createTask(s.mia, "OPA", { title: "Planned", sprintId: s.planned.id });
    const board = await createTask(s.mia, "OPA", { title: "Board", columnId: s.done.id });
    const backlog = await createTask(s.mia, "OPA", { title: "Backlog" });

    const toBacklog = await updateTask(s.mia, board.key, { parentId: planned.key, version: 1 });
    expect([toBacklog.columnId, toBacklog.sprint?.id]).toEqual([null, s.planned.id]);
    expect((await backlogKeys(s)).at(-1)).toBe(board.key);
    const toBoard = await updateTask(s.mia, backlog.key, { parentId: active.key, version: 1 });
    expect([toBoard.columnId, toBoard.sprint?.id]).toEqual([s.todo.id, s.active.id]);

    const detached = await updateTask(s.mia, toBoard.key, {
      parentId: null,
      version: toBoard.version,
    });
    expect([detached.columnId, detached.sprint?.id]).toEqual([s.todo.id, s.active.id]);
  });

  it("follows the parent's sprint when it changes, with history and events", async () => {
    const s = await setup();
    const parent = await createTask(s.mia, "OPA", { title: "Parent", sprintId: s.planned.id });
    const sub = await createTask(s.mia, "OPA", { title: "Sub", parentId: parent.key });
    const listener = await listenForEvents();
    try {
      const updated = await updateTask(s.mia, parent.key, {
        sprintId: s.active.id,
        version: (await getTask(s.mia, parent.key)).version,
      });
      expect(updated.subtaskList.map((t) => [t.columnId, t.sprint?.id])).toEqual([
        [s.todo.id, s.active.id],
      ]);
      await listener.settle();
      expect(
        listener
          .events()
          .filter((e) => e.entityId === sub.id)
          .map((e) => e.type),
      ).toEqual(["task.moved"]);
      expect((await historyOf(sub.id)).slice(1)).toMatchObject([
        {
          type: "field_changed",
          field: "sprintId",
          newValue: s.active.id,
          actorAccountId: s.mia.accountId,
        },
        { type: "moved", newValue: { columnId: s.todo.id } },
      ]);

      const back = await moveTask(s.mia, parent.key, { columnId: null, version: updated.version });
      expect(back.subtaskList.map((t) => [t.columnId, t.sprint])).toEqual([[null, null]]);
    } finally {
      await listener.close();
    }
  });

  it("refuses a differing sprintId (400) and moves against the parent (409)", async () => {
    const s = await setup();
    const active = await createTask(s.mia, "OPA", { title: "Active", columnId: s.doing.id });
    const planned = await createTask(s.mia, "OPA", { title: "Planned", sprintId: s.planned.id });
    const onBoard = await createTask(s.mia, "OPA", { title: "Sub", parentId: active.key });
    const inBacklog = await createTask(s.mia, "OPA", { title: "Sub", parentId: planned.key });

    const differing = await failure(updateTask(s.mia, onBoard.key, { sprintId: null, version: 1 }));
    expect(fieldFailure(differing)).toEqual([400, "invalid_request", ["sprintId"]]);
    const same = await updateTask(s.mia, onBoard.key, {
      sprintId: s.active.id,
      title: "S",
      version: 1,
    });
    expect(same.sprint?.id).toBe(s.active.id);

    const off = await failure(
      moveTask(s.mia, onBoard.key, { columnId: null, version: same.version }),
    );
    expect([off.status, off.code]).toEqual([409, "subtask_follows_parent"]);
    const on = await failure(moveTask(s.mia, inBacklog.key, { columnId: s.todo.id, version: 1 }));
    expect([on.status, on.code]).toEqual([409, "subtask_follows_parent"]);
    const between = await moveTask(s.mia, onBoard.key, {
      columnId: s.done.id,
      version: same.version,
    });
    expect(between.columnId).toBe(s.done.id);
  });

  it("refuses a parent in a completed sprint (409 sprint_completed, deviation B)", async () => {
    const s = await setup();
    const parent = await createTask(s.mia, "OPA", { title: "Done", columnId: s.done.id });
    const other = await createTask(s.mia, "OPA", { title: "Other" });
    await setState(s.active.id, "completed");

    const created = await failure(createTask(s.mia, "OPA", { title: "Sub", parentId: parent.key }));
    expect([created.status, created.code]).toEqual([409, "sprint_completed"]);
    const attached = await failure(
      updateTask(s.mia, other.key, { parentId: parent.key, version: 1 }),
    );
    expect([attached.status, attached.code]).toEqual([409, "sprint_completed"]);
  });
});

describe("restoreTask in sprints (WS-141 test 8)", () => {
  it("sends a task whose place breaks the rule to the end of the backlog, unscheduled", async () => {
    const s = await setup();
    const backlog = await createTask(s.mia, "OPA", { title: "Backlog" });
    const task = await createTask(s.mia, "OPA", { title: "Board", columnId: s.doing.id });
    await deleteTask(s.manager, task.key);
    // The sprint is no longer active: say it was planned again, as nothing else can.
    await setState(s.active.id, "planned");

    const restored = await restoreTask(s.manager, task.key);
    expect([restored.columnId, restored.sprint]).toEqual([null, null]);
    expect(await backlogKeys(s)).toEqual([backlog.key, task.key]);
    expect((await historyOf(task.id)).slice(-3)).toMatchObject([
      { type: "restored" },
      { type: "moved", oldValue: { columnId: s.doing.id }, newValue: { columnId: null } },
      { type: "field_changed", field: "sprintId", oldValue: s.active.id, newValue: null },
    ]);
  });

  it("brings back where it was a task whose place keeps the rule", async () => {
    const s = await setup();
    const task = await createTask(s.mia, "OPA", { title: "Board", columnId: s.doing.id });
    const planned = await createTask(s.mia, "OPA", { title: "Planned", sprintId: s.planned.id });
    await deleteTask(s.manager, task.key);
    await deleteTask(s.manager, planned.key);

    const restored = await restoreTask(s.manager, task.key);
    expect([restored.columnId, restored.sprint?.id]).toEqual([s.doing.id, s.active.id]);
    const back = await restoreTask(s.manager, planned.key);
    expect([back.columnId, back.sprint?.id]).toEqual([null, s.planned.id]);
  });

  it("brings a task back to its column in a project without sprints", async () => {
    const s = await setup({ sprints: false });
    const task = await createTask(s.mia, "OPA", { title: "Board", columnId: s.doing.id });
    await deleteTask(s.manager, task.key);

    expect((await restoreTask(s.manager, task.key)).columnId).toBe(s.doing.id);
  });
});

describe("a project without sprints (WS-141 test 9)", () => {
  it("refuses a non-null sprintId (409 sprints_disabled) and accepts null", async () => {
    const s = await setup({ sprints: false });
    const task = await createTask(s.mia, "OPA", { title: "Task" });

    for (const write of [
      () => createTask(s.mia, "OPA", { title: "X", sprintId: s.planned.id }),
      () => updateTask(s.mia, task.key, { sprintId: s.planned.id, version: 1 }),
      () => moveTask(s.mia, task.key, { columnId: null, sprintId: s.planned.id, version: 1 }),
    ]) {
      const error = await failure(write());
      expect([error.status, error.code]).toEqual([409, "sprints_disabled"]);
    }
    const none = await updateTask(s.mia, task.key, { sprintId: null, title: "Y", version: 1 });
    expect([none.columnId, none.sprint]).toEqual([s.todo.id, null]);
  });

  it("clears a kept planned sprint when a write gives the task a column", async () => {
    const s = await setup({ active: false });
    const kept = await createTask(s.mia, "OPA", { title: "Kept", sprintId: s.planned.id });
    const other = await createTask(s.mia, "OPA", { title: "Other", sprintId: s.planned.id });
    await updateProject(s.manager, "OPA", { sprintsEnabled: false, version: 2 });

    const reordered = await moveTask(s.mia, other.key, { columnId: null, version: 1 });
    expect(reordered.sprint?.id).toBe(s.planned.id);
    const moved = await moveTask(s.mia, kept.key, { columnId: s.todo.id, version: 1 });
    expect([moved.columnId, moved.sprint]).toEqual([s.todo.id, null]);
    expect((await historyOf(kept.id)).slice(1)).toMatchObject([
      { type: "moved" },
      { type: "field_changed", field: "sprintId", oldValue: s.planned.id, newValue: null },
    ]);
  });
});

describe("the active sprint's lock (WS-141 test 10)", () => {
  it("makes writes into the active sprint wait for a sprint row locked for update", async () => {
    const s = await setup();
    const task = await createTask(s.mia, "OPA", { title: "Backlog" });
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked = (): void => undefined;
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const holder = getDb().transaction(async (tx) => {
      await tx.execute(sql`select 1 from sprints where id = ${s.active.id} for update`);
      locked();
      await held;
    });
    await isLocked;

    const finished: string[] = [];
    const move = moveTask(s.mia, task.key, { columnId: s.todo.id, version: 1 }).then(() =>
      finished.push("move"),
    );
    const create = createTask(s.mia, "OPA", { title: "New", columnId: s.doing.id }).then(() =>
      finished.push("create"),
    );
    try {
      const deadline = Date.now() + 3_000;
      for (;;) {
        const [row] = await getDb().execute<{ n: number }>(sql`
          select count(*)::int as n from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'`);
        if ((row?.n ?? 0) >= 2 || Date.now() > deadline) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(finished).toEqual([]);
    } finally {
      release();
      await Promise.allSettled([holder, move, create]);
    }
    expect(finished.sort()).toEqual(["create", "move"]);
    expect((await getTask(s.mia, task.key)).sprint?.id).toBe(s.active.id);
  });
});
