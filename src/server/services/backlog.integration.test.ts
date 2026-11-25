// The backlog (WS-101): tasks with no column, in the project's backlog order.
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createTestAccount, createTestAgent, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { taskEvents, tasks } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

import { loadAgentActor } from "./agents";
import { listColumns } from "./columns";
import { createComment } from "./comments";
import { createEpic, getEpic } from "./epics";
import { listenForEvents } from "./events-testing";
import { archiveProject, createProject } from "./projects";
import { recordingDb } from "./recording-db-testing";
import {
  createTask,
  deleteTask,
  getTask,
  listBacklog,
  listTasks,
  moveTask,
  restoreTask,
  updateTask,
} from "./tasks";

async function setup() {
  const manager = testActor(
    await createTestAccount({ email: "manager@example.com", role: "manager" }),
  );
  const member = await createTestAccount({ name: "Mia", email: "mia@example.com", role: "member" });
  const actor = testActor(member);
  const project = await createProject(manager, { key: "OPA", name: "Opanel" });
  const [todo, progress, done] = (await listColumns(manager, "OPA")).items.map(
    (column) => column.id,
  );
  if (!todo || !progress || !done) throw new Error("no columns");
  return { manager, member, actor, project, todo, progress, done };
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

/** Task keys of the backlog, in backlog order. */
async function backlog(actor: Setup["actor"], projectRef = "OPA") {
  return (await listBacklog(actor, projectRef, { limit: 100 })).items.map((task) => task.key);
}

async function events(taskId: string, type: string) {
  return getDb()
    .select()
    .from(taskEvents)
    .where(eq(taskEvents.taskId, taskId))
    .then((rows) => rows.filter((row) => row.type === type));
}

describe("the backlog index", () => {
  it("refuses two backlog tasks of one project at one position, not across projects or columns", async () => {
    const { actor, manager, todo } = await setup();
    await createProject(manager, { key: "WEB", name: "Web" });
    const a = await createTask(actor, "OPA", { title: "A", columnId: null });
    const b = await createTask(actor, "OPA", { title: "B", columnId: null });
    const web = await createTask(actor, "WEB", { title: "W", columnId: null });
    const board = await createTask(actor, "OPA", { title: "C", columnId: todo });
    const [first] = await getDb().select().from(tasks).where(eq(tasks.id, a.id));
    if (!first) throw new Error("no task");

    await expect(
      getDb().update(tasks).set({ position: first.position }).where(eq(tasks.id, b.id)),
    ).rejects.toThrow();
    await getDb().update(tasks).set({ position: first.position }).where(eq(tasks.id, web.id));
    await getDb().update(tasks).set({ position: first.position }).where(eq(tasks.id, board.id));
  });
});

describe("createTask in the backlog", () => {
  it("puts tasks at the end of the backlog with a created entry naming no column", async () => {
    const { actor, todo } = await setup();
    const a = await createTask(actor, "OPA", { title: "A", columnId: null });
    await createTask(actor, "OPA", { title: "B", columnId: null });
    const onBoard = await createTask(actor, "OPA", { title: "C" });

    expect(a.columnId).toBeNull();
    expect(onBoard.columnId).toBe(todo);
    expect(await backlog(actor)).toEqual(["OPA-1", "OPA-2"]);
    const created = await events(a.id, "created");
    expect(created).toHaveLength(1);
    expect(created[0]?.newValue).toMatchObject({ columnId: null });
  });
});

describe("moveTask and the backlog", () => {
  it("moves to the end, after and before a backlog task, within the backlog and back", async () => {
    const { actor, member, todo } = await setup();
    const a = await createTask(actor, "OPA", { title: "A", columnId: null });
    const b = await createTask(actor, "OPA", { title: "B", columnId: null });
    const c = await createTask(actor, "OPA", { title: "C" });
    const d = await createTask(actor, "OPA", { title: "D" });
    const listener = await listenForEvents();

    try {
      const moved = await moveTask(actor, c.id, { columnId: null, version: 1 });
      expect(moved).toMatchObject({ key: "OPA-3", columnId: null, version: 2 });
      expect(await backlog(actor)).toEqual(["OPA-1", "OPA-2", "OPA-3"]);

      await moveTask(actor, d.id, { columnId: null, afterTaskId: a.id, version: 1 });
      expect(await backlog(actor)).toEqual(["OPA-1", "OPA-4", "OPA-2", "OPA-3"]);

      await moveTask(actor, c.id, { columnId: null, beforeTaskId: a.id, version: 2 });
      expect(await backlog(actor)).toEqual(["OPA-3", "OPA-1", "OPA-4", "OPA-2"]);

      const back = await moveTask(actor, b.id, { columnId: todo, version: 1 });
      expect(back).toMatchObject({ columnId: todo, version: 2 });
      expect(await backlog(actor)).toEqual(["OPA-3", "OPA-1", "OPA-4"]);
      expect(
        (await listTasks(actor, "OPA", { limit: 100, columnId: [todo] })).items.map((t) => t.key),
      ).toEqual(["OPA-2"]);

      await listener.settle();
      expect(
        listener
          .events()
          .filter((event) => event.type === "task.moved")
          .map((event) => [event.entityId, event.version]),
      ).toEqual([
        [c.id, 2],
        [d.id, 2],
        [c.id, 3],
        [b.id, 2],
      ]);
    } finally {
      await listener.close();
    }

    // A moved entry only when the column changes, null included.
    expect(await events(c.id, "moved")).toEqual([
      expect.objectContaining({
        actorAccountId: member.id,
        oldValue: { columnId: todo },
        newValue: { columnId: null },
      }),
    ]);
    expect(await events(b.id, "moved")).toEqual([
      expect.objectContaining({ oldValue: { columnId: null }, newValue: { columnId: todo } }),
    ]);
  });

  it("keeps the position of a move into its own gap", async () => {
    const { actor } = await setup();
    const a = await createTask(actor, "OPA", { title: "A", columnId: null });
    const b = await createTask(actor, "OPA", { title: "B", columnId: null });
    const [before] = await getDb().select().from(tasks).where(eq(tasks.id, b.id));

    const same = await moveTask(actor, b.id, { columnId: null, afterTaskId: a.id, version: 1 });
    const [after] = await getDb().select().from(tasks).where(eq(tasks.id, b.id));

    expect(same.version).toBe(2);
    expect(after?.position).toBe(before?.position);
  });

  it("refuses anchors outside the backlog with 400 and a stale version with version_conflict", async () => {
    const { actor, manager, todo } = await setup();
    await createProject(manager, { key: "WEB", name: "Web" });
    const task = await createTask(actor, "OPA", { title: "A" });
    const inColumn = await createTask(actor, "OPA", { title: "B", columnId: todo });
    const elsewhere = await createTask(actor, "WEB", { title: "W", columnId: null });
    const gone = await createTask(actor, "OPA", { title: "Gone", columnId: null });
    await getDb().update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, gone.id));

    for (const anchor of [inColumn.id, elsewhere.id, gone.id]) {
      const after = await failure(
        moveTask(actor, task.id, { columnId: null, afterTaskId: anchor, version: 1 }),
      );
      expect(after.status).toBe(400);
      expect(after.errors).toEqual([
        { path: "afterTaskId", message: "Not another task of the backlog." },
      ]);
      const before = await failure(
        moveTask(actor, task.id, { columnId: null, beforeTaskId: anchor, version: 1 }),
      );
      expect(before.errors?.[0]?.path).toBe("beforeTaskId");
    }

    const stale = await failure(moveTask(actor, task.id, { columnId: null, version: 7 }));
    expect(stale.code).toBe("version_conflict");
    expect((await getTask(actor, task.id)).columnId).toBe(todo);
  });

  it("gives twenty concurrent creations and moves into one backlog distinct positions", async () => {
    const { actor } = await setup();
    const onBoard = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        createTask(actor, "OPA", { title: `B${String(index)}` }),
      ),
    );

    await Promise.all([
      ...onBoard.map((task) => moveTask(actor, task.id, { columnId: null, version: 1 })),
      ...Array.from({ length: 10 }, (_, index) =>
        createTask(actor, "OPA", { title: `N${String(index)}`, columnId: null }),
      ),
    ]);

    const rows = await getDb().execute<{ position: string }>(
      sql`select position from tasks where column_id is null`,
    );
    expect(new Set(rows.map((row) => row.position)).size).toBe(20);
    const first = await backlog(actor);
    expect(first).toHaveLength(20);
    expect(await backlog(actor)).toEqual(first);
    // Thirty transactions that queue on one project row: about 6 s on a loaded machine.
  }, 30_000);
});

describe("the backlog on an archived project (WS-115)", () => {
  it("refuses a task created in it and moves to and from it with project_archived", async () => {
    const { actor, manager, todo } = await setup();
    const waiting = await createTask(actor, "OPA", { title: "Waiting", columnId: null });
    const onBoard = await createTask(actor, "OPA", { title: "On the board", columnId: todo });
    await archiveProject(manager, "OPA");

    const refused = [
      await failure(createTask(actor, "OPA", { title: "New", columnId: null })),
      await failure(moveTask(actor, waiting.id, { columnId: todo, version: 1 })),
      await failure(moveTask(actor, onBoard.id, { columnId: null, version: 1 })),
    ];
    expect(refused.map((error) => [error.status, error.code])).toEqual([
      [409, "project_archived"],
      [409, "project_archived"],
      [409, "project_archived"],
    ]);
    expect(await backlog(actor)).toEqual(["OPA-1"]);
  });
});

describe("listBacklog", () => {
  it("lists live backlog tasks in order across pages, never a deleted or board task", async () => {
    const { actor } = await setup();
    for (const title of ["A", "B", "C", "D", "E"]) {
      await createTask(actor, "OPA", { title, columnId: null });
    }
    await createTask(actor, "OPA", { title: "Board" });
    await deleteTask(actor, "OPA-3");

    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listBacklog(actor, "OPA", { limit: 2, ...(cursor ? { cursor } : {}) });
      keys.push(...page.items.map((task) => task.key));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    expect(keys).toEqual(["OPA-1", "OPA-2", "OPA-4", "OPA-5"]);
  });

  it("answers 404 for an unknown project and 403 for a project outside an agent's list", async () => {
    const { actor, manager, project } = await setup();
    await createProject(manager, { key: "WEB", name: "Web" });
    const agent = await createTestAgent({
      name: "Worker",
      role: "worker_agent",
      projectIds: [project.id],
    });
    const loaded = await loadAgentActor(getDb(), agent.id);
    if (!loaded) throw new Error("no agent");
    const agentActor = loaded.actor;

    expect((await failure(listBacklog(actor, "NOPE", { limit: 10 }))).status).toBe(404);
    expect((await failure(listBacklog(agentActor, "WEB", { limit: 10 }))).status).toBe(403);
    expect((await listBacklog(agentActor, "OPA", { limit: 10 })).items).toEqual([]);
  });
});

describe("listTasks and the backlog", () => {
  it("leaves backlog tasks out; deleted=true lists them after the columns' tasks, and restore keeps their place", async () => {
    const { actor, manager } = await setup();
    await createTask(actor, "OPA", { title: "A", columnId: null });
    await createTask(actor, "OPA", { title: "B" });
    await createTask(actor, "OPA", { title: "C", columnId: null });
    await createTask(actor, "OPA", { title: "D", columnId: null });

    expect((await listTasks(actor, "OPA", { limit: 100 })).items.map((t) => t.key)).toEqual([
      "OPA-2",
    ]);

    await deleteTask(actor, "OPA-3");
    await deleteTask(actor, "OPA-2");
    const deleted: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listTasks(manager, "OPA", {
        limit: 1,
        deleted: "true",
        ...(cursor ? { cursor } : {}),
      });
      deleted.push(...page.items.map((task) => task.key));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(deleted).toEqual(["OPA-2", "OPA-3"]);

    const restored = await restoreTask(manager, "OPA-3");
    expect(restored.columnId).toBeNull();
    expect(await backlog(actor)).toEqual(["OPA-1", "OPA-3", "OPA-4"]);
  });
});

describe("a backlog task through every task operation", () => {
  it("is read by id and key, edited, commented and deleted, each answering columnId null", async () => {
    const { actor, manager } = await setup();
    const task = await createTask(actor, "OPA", { title: "A", columnId: null });

    expect((await getTask(actor, task.id)).columnId).toBeNull();
    expect((await getTask(actor, "OPA-1")).columnId).toBeNull();
    expect((await updateTask(actor, "OPA-1", { title: "B", version: 1 })).columnId).toBeNull();
    await createComment(actor, "OPA-1", { body: "Later." });
    await deleteTask(actor, "OPA-1");
    expect((await restoreTask(manager, "OPA-1")).columnId).toBeNull();
  });
});

describe("epic progress and the backlog", () => {
  it("counts a backlog task in the total and not as done", async () => {
    const { actor, manager, done } = await setup();
    const epic = await createEpic(manager, "OPA", { title: "Launch" });
    await createTask(actor, "OPA", { title: "Done", columnId: done, epicId: epic.id });
    await createTask(actor, "OPA", { title: "Board", epicId: epic.id });
    await createTask(actor, "OPA", { title: "Later", columnId: null, epicId: epic.id });

    expect((await getEpic(actor, epic.id)).progress).toEqual({ doneTasks: 1, totalTasks: 3 });
  });
});

describe("what listBacklog takes from the database (WS-122 test 2)", () => {
  it("reads no description, on either page or with a filter", async () => {
    const { actor } = await setup();
    for (const title of ["Alpha", "Beta", "Gamma"]) {
      await createTask(actor, "OPA", { title, columnId: null, description: `About ${title}` });
    }
    const recording = recordingDb();

    const first = await listBacklog(actor, "OPA", { limit: 2 }, recording.db);
    await listBacklog(actor, "OPA", { limit: 2, cursor: first.nextCursor ?? "" }, recording.db);
    await listBacklog(actor, "OPA", { limit: 50, q: "beta" }, recording.db);

    expect(recording.taskRows()).not.toHaveLength(0);
    for (const row of recording.taskRows()) expect(Object.keys(row)).not.toContain("description");
  });
});
