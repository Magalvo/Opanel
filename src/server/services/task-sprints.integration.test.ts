// Tasks in sprints: the board list, the backlog, answers, history, events and who may set a
// sprint (WS-141 tests 11 to 17).
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { taskListQuerySchema } from "@/lib/schemas/tasks";
import { agentActor } from "@/server/auth/actor";
import { createTestAccount, createTestAgent, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { taskEvents } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

import { listColumns } from "./columns";
import { listenForEvents } from "./events-testing";
import { createProject, updateProject } from "./projects";
import { createSprint } from "./sprints";
import {
  createTask,
  getTask,
  listAllTasks,
  listBacklog,
  listTasks,
  moveTask,
  updateTask,
} from "./tasks";

const UNKNOWN = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";
const DATES = { startDate: "2026-12-01", endDate: "2026-12-14" };

async function setState(sprintId: string, state: "planned" | "active" | "completed") {
  await getDb().execute(sql`
    update sprints set state = ${state},
      started_at = ${state === "planned" ? null : sql`now()`},
      completed_at = ${state === "completed" ? sql`now()` : null},
      total_points = ${state === "completed" ? 0 : null},
      completed_points = ${state === "completed" ? 0 : null},
      total_tasks = ${state === "completed" ? 0 : null},
      completed_tasks = ${state === "completed" ? 0 : null},
      unestimated = ${state === "completed" ? 0 : null}
    where id = ${sprintId}`);
}

async function setup() {
  const manager = testActor(
    await createTestAccount({ name: "Manager", email: "manager@example.com", role: "manager" }),
  );
  const mia = testActor(
    await createTestAccount({ name: "Mia", email: "mia@example.com", role: "member" }),
  );
  const opa = await createProject(manager, { key: "OPA", name: "Opanel" });
  const web = await createProject(manager, { key: "WEB", name: "Website" });
  await updateProject(manager, "OPA", { sprintsEnabled: true, version: 1 });
  await updateProject(manager, "WEB", { sprintsEnabled: true, version: 1 });
  const [todo, doing, done] = (await listColumns(manager, "OPA")).items;
  if (!todo || !doing || !done) throw new Error("no columns");
  const active = await createSprint(manager, "OPA", { name: "Sprint 1", ...DATES });
  const planned = await createSprint(manager, "OPA", { name: "Sprint 2", ...DATES });
  const foreign = await createSprint(manager, "WEB", { name: "Web 1", ...DATES });
  await setState(active.id, "active");
  return { manager, mia, opa, web, todo, doing, done, active, planned, foreign };
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

async function historyOf(taskId: string) {
  return getDb()
    .select()
    .from(taskEvents)
    .where(eq(taskEvents.taskId, taskId))
    .orderBy(taskEvents.id);
}

const board = (query: Record<string, unknown> = {}) =>
  taskListQuerySchema.parse({ limit: 100, ...query });

describe("the board list (WS-141 test 11)", () => {
  it("lists only the active sprint's tasks", async () => {
    const s = await setup();
    const inSprint = await createTask(s.mia, "OPA", { title: "In", columnId: s.doing.id });
    const old = await createTask(s.mia, "OPA", { title: "Old", columnId: s.done.id });
    // A task of a completed sprint keeps its column, as the sprint's record.
    const record = await createSprint(s.manager, "OPA", { name: "Sprint 0", ...DATES });
    await getDb().execute(sql`update tasks set sprint_id = ${record.id} where id = ${old.id}`);
    await setState(record.id, "completed");
    await createTask(s.mia, "OPA", { title: "Backlog" });

    const page = await listTasks(s.mia, "OPA", board());
    expect(page.items.map((task) => task.key)).toEqual([inSprint.key]);
  });

  it("lists nothing when no sprint is active", async () => {
    const s = await setup();
    await createTask(s.mia, "OPA", { title: "In", columnId: s.doing.id });
    await setState(s.active.id, "planned");

    expect((await listTasks(s.mia, "OPA", board())).items).toEqual([]);
  });

  it("lists every task with a column in a project without sprints", async () => {
    const s = await setup();
    const one = await createTask(s.mia, "OPA", { title: "One", columnId: s.todo.id });
    await setState(s.active.id, "completed");
    await updateProject(s.manager, "OPA", { sprintsEnabled: false, version: 2 });
    const two = await createTask(s.mia, "OPA", { title: "Two" });

    expect((await listTasks(s.mia, "OPA", board())).items.map((task) => task.key)).toEqual([
      one.key,
      two.key,
    ]);
  });
});

describe("the backlog (WS-141 test 12)", () => {
  it("lists planned-sprint and unscheduled tasks in one ranking, each with its sprint", async () => {
    const s = await setup();
    const a = await createTask(s.mia, "OPA", { title: "A" });
    const b = await createTask(s.mia, "OPA", { title: "B", sprintId: s.planned.id });
    const c = await createTask(s.mia, "OPA", { title: "C" });

    const page = await listBacklog(s.mia, "OPA", { limit: 100 });
    expect(page.items.map((task) => [task.key, task.sprint])).toEqual([
      [a.key, null],
      [b.key, { id: s.planned.id, name: "Sprint 2", state: "planned" }],
      [c.key, null],
    ]);
  });
});

describe("answers (WS-141 test 13)", () => {
  it("carry sprint everywhere, and refuse a foreign or unknown sprintId (400)", async () => {
    const s = await setup();
    const task = await createTask(s.mia, "OPA", { title: "T", columnId: s.todo.id });
    const sprint = { id: s.active.id, name: "Sprint 1", state: "active" };

    expect((await getTask(s.mia, task.key)).sprint).toEqual(sprint);
    expect((await listTasks(s.mia, "OPA", board())).items[0]?.sprint).toEqual(sprint);
    expect(
      (await listAllTasks(s.mia, { limit: 100, sort: "-updated" })).items.find(
        (item) => item.id === task.id,
      )?.sprint,
    ).toEqual(sprint);

    for (const sprintId of [s.foreign.id, UNKNOWN]) {
      const error = await failure(updateTask(s.mia, task.key, { sprintId, version: 1 }));
      expect([error.status, error.errors?.[0]?.path]).toEqual([400, "sprintId"]);
      expect(error.errors?.[0]?.message).toBe("Not a sprint of this project.");
    }
  });
});

describe("history (WS-141 test 14)", () => {
  it("records sprintId changes by the actor, with the moved entry when the column changes", async () => {
    const s = await setup();
    const task = await createTask(s.mia, "OPA", { title: "T" });
    await updateTask(s.mia, task.key, { sprintId: s.planned.id, version: 1 });
    await updateTask(s.manager, task.key, { sprintId: s.active.id, version: 2 });

    expect(
      (await historyOf(task.id))
        .slice(1)
        .map((e) => [e.type, e.field, e.oldValue, e.newValue, e.actorAccountId]),
    ).toEqual([
      ["field_changed", "sprintId", null, s.planned.id, s.mia.accountId],
      ["field_changed", "sprintId", s.planned.id, s.active.id, s.manager.accountId],
      ["moved", null, { columnId: null }, { columnId: s.todo.id }, s.manager.accountId],
    ]);
  });
});

describe("events (WS-141 test 15)", () => {
  it("sends task.updated for a sprint change, task.moved with the column, and the parent's", async () => {
    const s = await setup();
    const task = await createTask(s.mia, "OPA", { title: "T" });
    const parent = await createTask(s.mia, "OPA", { title: "P", columnId: s.todo.id });
    const sub = await createTask(s.mia, "OPA", { title: "S", parentId: parent.key });
    const listener = await listenForEvents();
    try {
      await updateTask(s.mia, task.key, { sprintId: s.planned.id, version: 1 });
      await updateTask(s.mia, task.key, { sprintId: s.active.id, version: 2 });
      await moveTask(s.mia, sub.key, { columnId: s.done.id, version: 1 });
      await listener.settle();

      expect(listener.events().map((e) => [e.type, e.entityId, e.version])).toEqual([
        ["task.updated", task.id, 2],
        ["task.moved", task.id, 3],
        ["task.moved", sub.id, 2],
        ["task.updated", parent.id, parent.version],
      ]);
    } finally {
      await listener.close();
    }
  });
});

describe("who may set a sprint (WS-141 tests 16 and 17)", () => {
  it("refuses a Viewer and a qa_agent (403); a worker_agent may", async () => {
    const s = await setup();
    const task = await createTask(s.mia, "OPA", { title: "T" });
    const viewer = testActor(await createTestAccount({ email: "vic@example.com", role: "viewer" }));
    const qaScopes = ["projects:read", "tasks:read", "reports:write"] as const;
    const qa = await createTestAgent({ name: "QA", role: "qa_agent", scopes: [...qaScopes] });
    const qaActor = agentActor({
      accountId: qa.id,
      role: "qa_agent",
      scopes: qaScopes,
      projectIds: null,
    });
    const workerScopes = ["projects:read", "tasks:read", "tasks:write"] as const;
    const worker = await createTestAgent({
      name: "W",
      role: "worker_agent",
      scopes: [...workerScopes],
    });
    const workerActor = agentActor({
      accountId: worker.id,
      role: "worker_agent",
      scopes: workerScopes,
      projectIds: null,
    });

    for (const actor of [viewer, qaActor]) {
      const error = await failure(
        updateTask(actor, task.key, { sprintId: s.planned.id, version: 1 }),
      );
      expect(error.status).toBe(403);
    }
    const set = await updateTask(workerActor, task.key, { sprintId: s.planned.id, version: 1 });
    expect(set.sprint?.id).toBe(s.planned.id);
  });

  it("refuses a restricted agent another project's sprint (400)", async () => {
    const s = await setup();
    const task = await createTask(s.mia, "OPA", { title: "T" });
    const scopes = ["projects:read", "tasks:read", "tasks:write"] as const;
    const worker = await createTestAgent({
      name: "W",
      role: "worker_agent",
      scopes: [...scopes],
      projectIds: [s.opa.id],
    });
    const actor = agentActor({
      accountId: worker.id,
      role: "worker_agent",
      scopes,
      projectIds: [s.opa.id],
    });

    const error = await failure(
      updateTask(actor, task.key, { sprintId: s.foreign.id, version: 1 }),
    );
    expect([error.status, error.errors?.[0]?.path]).toEqual([400, "sprintId"]);
    const create = await failure(createTask(actor, "OPA", { title: "X", sprintId: s.foreign.id }));
    expect([create.status, create.errors?.[0]?.path]).toEqual([400, "sprintId"]);
  });
});
