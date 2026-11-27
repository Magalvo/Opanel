import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ProjectEvent } from "@/lib/schemas/events";
import { taskListQuerySchema } from "@/lib/schemas/tasks";
import { agentActor } from "@/server/auth/actor";
import { createTestAccount, createTestAgent, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { taskEvents } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

import { listColumns } from "./columns";
import { createEpic } from "./epics";
import { type EventListener, listenForEvents } from "./events-testing";
import { createProject } from "./projects";
import {
  createTask,
  deleteTask,
  getTask,
  listTasks,
  moveTask,
  restoreTask,
  updateTask,
} from "./tasks";

// Sub-tasks in the API (WS-133 tests 2 to 11).

let listener: EventListener;

beforeEach(async () => {
  listener = await listenForEvents();
});

afterEach(async () => {
  await listener.close();
});

async function setup() {
  const managerAccount = await createTestAccount({
    name: "Manager",
    email: "manager@example.com",
    role: "manager",
  });
  const manager = testActor(managerAccount);
  const mia = testActor(
    await createTestAccount({ name: "Mia", email: "mia@example.com", role: "member" }),
  );
  await createProject(manager, { key: "OPA", name: "Opanel" });
  await createProject(manager, { key: "WEB", name: "Website" });
  const [todo, doing, done] = (await listColumns(manager, "OPA")).items;
  if (!todo || !doing || !done) throw new Error("no columns");
  const parent = await createTask(mia, "OPA", { title: "Release 2.0" });
  return { manager, mia, todo, doing, done, parent };
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

async function historyOf(taskId: string) {
  return getDb()
    .select()
    .from(taskEvents)
    .where(eq(taskEvents.taskId, taskId))
    .orderBy(taskEvents.id);
}

async function version(s: Setup, ref: string): Promise<number> {
  return (await getTask(s.manager, ref)).version;
}

async function sub(s: Setup, title: string, extra: Record<string, unknown> = {}) {
  return createTask(s.mia, "OPA", { title, parentId: s.parent.key, ...extra });
}

/** The events committed during `write`. */
async function eventsOf(write: () => Promise<unknown>): Promise<ProjectEvent[]> {
  await listener.settle();
  const before = listener.events().length;
  await write();
  await listener.settle();
  return listener.events().slice(before);
}

describe("setting and clearing a parent (WS-133 test 2)", () => {
  it("makes a task a sub-task on create, by key, and answers its parent", async () => {
    const s = await setup();

    const child = await sub(s, "Write the notes");

    expect(child.parent).toEqual({ id: s.parent.id, key: "OPA-1", title: "Release 2.0" });
    expect(child.subtasks).toBeNull();
    expect((await getTask(s.mia, "OPA-2")).parent?.key).toBe("OPA-1");
  });

  it("makes a task a sub-task on edit, by id, and a normal task again with null", async () => {
    const s = await setup();
    const task = await createTask(s.mia, "OPA", { title: "Tag the build" });

    const attached = await updateTask(s.mia, task.key, {
      parentId: s.parent.id,
      version: task.version,
    });
    expect(attached.parent?.id).toBe(s.parent.id);

    const detached = await updateTask(s.mia, task.key, {
      parentId: null,
      version: attached.version,
    });
    expect(detached.parent).toBeNull();

    const changes = (await historyOf(task.id)).filter((entry) => entry.field === "parentId");
    expect(changes.map((entry) => [entry.oldValue, entry.newValue])).toEqual([
      [null, s.parent.id],
      [s.parent.id, null],
    ]);
  });
});

describe("refusals (WS-133 test 3)", () => {
  it("refuses each forbidden parent with 400 on parentId, writing nothing", async () => {
    const s = await setup();
    const child = await sub(s, "A sub-task");
    const other = await createTask(s.mia, "WEB", { title: "Elsewhere" });
    const gone = await createTask(s.mia, "OPA", { title: "Gone" });
    await deleteTask(s.manager, gone.key);
    const plain = await createTask(s.mia, "OPA", { title: "Plain" });

    // Each write runs only when its turn comes, so none is refused before it is awaited.
    const cases: [string, () => Promise<unknown>][] = [
      ["unknown", () => createTask(s.mia, "OPA", { title: "X", parentId: "OPA-99" })],
      ["deleted", () => createTask(s.mia, "OPA", { title: "X", parentId: gone.key })],
      ["other project", () => createTask(s.mia, "OPA", { title: "X", parentId: other.key })],
      ["a sub-task", () => createTask(s.mia, "OPA", { title: "X", parentId: child.key })],
      [
        "itself",
        () => updateTask(s.mia, plain.key, { parentId: plain.id, version: plain.version }),
      ],
      [
        "has sub-tasks",
        () => updateTask(s.mia, s.parent.key, { parentId: plain.key, version: s.parent.version }),
      ],
    ];
    for (const [name, write] of cases) {
      const error = await failure(write());
      expect(error.status, name).toBe(400);
      expect(
        error.errors?.map((field) => field.path),
        name,
      ).toEqual(["parentId"]);
    }
    expect((await getTask(s.mia, plain.key)).version).toBe(plain.version);
    expect((await getTask(s.mia, s.parent.key)).parent).toBeNull();
  });
});

describe("concurrent attaches (WS-133 test 4)", () => {
  it("lets only one of two writes that would chain three tasks pass", async () => {
    const s = await setup();
    const a = await createTask(s.mia, "OPA", { title: "A" });
    const b = await createTask(s.mia, "OPA", { title: "B" });
    const c = await createTask(s.mia, "OPA", { title: "C" });

    // b under a, and c under b: together they would make c a sub-task of a sub-task.
    const results = await Promise.allSettled([
      updateTask(s.mia, b.key, { parentId: a.key, version: b.version }),
      updateTask(s.mia, c.key, { parentId: b.key, version: c.version }),
    ]);

    const passed = results.filter((result) => result.status === "fulfilled");
    expect(passed).toHaveLength(1);
    const refused = results.find((result) => result.status === "rejected");
    expect(refused?.status === "rejected" && refused.reason instanceof ApiError).toBe(true);
    const parents = [
      (await getTask(s.mia, b.key)).parent?.key,
      (await getTask(s.mia, c.key)).parent?.key,
    ];
    expect(parents.filter((key) => key !== undefined)).toHaveLength(1);
  });
});

describe("the epic follows the parent (WS-133 test 5)", () => {
  it("copies the parent's epic on attach and follows its changes", async () => {
    const s = await setup();
    const launch = await createEpic(s.manager, "OPA", { title: "Launch" });
    const later = await createEpic(s.manager, "OPA", { title: "Later" });
    const parent = await updateTask(s.mia, s.parent.key, {
      epicId: launch.id,
      version: s.parent.version,
    });
    const child = await sub(s, "Child");
    expect(child.epic?.id).toBe(launch.id);

    await updateTask(s.mia, parent.key, { epicId: later.id, version: parent.version });

    const after = await getTask(s.mia, child.key);
    expect(after.epic?.id).toBe(later.id);
    expect(after.version).toBe(child.version + 1);
    const epicChanges = (await historyOf(child.id)).filter((entry) => entry.field === "epicId");
    expect(epicChanges.map((entry) => entry.newValue)).toEqual([later.id]);
  });

  it("refuses an epicId that differs from the parent's, and accepts the same one", async () => {
    const s = await setup();
    const launch = await createEpic(s.manager, "OPA", { title: "Launch" });
    const other = await createEpic(s.manager, "OPA", { title: "Other" });
    const parent = await updateTask(s.mia, s.parent.key, {
      epicId: launch.id,
      version: s.parent.version,
    });
    const child = await sub(s, "Child", { epicId: launch.id });

    const error = await failure(
      updateTask(s.mia, child.key, { epicId: other.id, version: child.version }),
    );
    expect(error.status).toBe(400);
    expect(error.errors?.map((field) => field.path)).toEqual(["epicId"]);
    const refusedOnCreate = await failure(sub(s, "Other child", { epicId: other.id }));
    expect(refusedOnCreate.errors?.map((field) => field.path)).toEqual(["epicId"]);

    const same = await updateTask(s.mia, child.key, {
      epicId: launch.id,
      title: "Child, renamed",
      version: child.version,
    });
    expect(same.title).toBe("Child, renamed");
    expect(parent.epic?.id).toBe(launch.id);
  });
});

describe("progress (WS-133 test 6)", () => {
  it("counts live sub-tasks, done only in a done column, never the backlog", async () => {
    const s = await setup();
    const alone = await getTask(s.mia, s.parent.key);
    expect(alone.subtasks).toBeNull();
    expect(alone.subtaskList).toEqual([]);
    const board = await listTasks(s.mia, "OPA", taskListQuerySchema.parse({}));
    expect(board.items.find((task) => task.key === "OPA-1")?.subtasks).toBeNull();

    const finished = await sub(s, "Finished", { columnId: s.done.id });
    await sub(s, "Started", { columnId: s.doing.id });
    await sub(s, "Waiting", { columnId: null });
    const dropped = await sub(s, "Dropped", { columnId: s.done.id });
    await deleteTask(s.manager, dropped.key);

    const listed = await listTasks(s.mia, "OPA", taskListQuerySchema.parse({}));
    expect(listed.items.find((task) => task.key === "OPA-1")?.subtasks).toEqual({
      done: 1,
      total: 3,
    });
    expect(listed.items.find((task) => task.key === finished.key)?.parent?.key).toBe("OPA-1");
  });
});

describe("the sub-task list (WS-133 test 7)", () => {
  it("answers the live sub-tasks in board order, then the backlog", async () => {
    const s = await setup();
    await sub(s, "In done", { columnId: s.done.id });
    await sub(s, "Backlog one", { columnId: null });
    await sub(s, "In to do", { columnId: s.todo.id });
    await sub(s, "In progress", { columnId: s.doing.id });
    await sub(s, "Backlog two", { columnId: null });

    const parent = await getTask(s.mia, s.parent.key);

    expect(parent.subtasks).toEqual({ done: 1, total: 5 });
    expect(parent.subtaskList.map((task) => task.title)).toEqual([
      "In to do",
      "In progress",
      "In done",
      "Backlog one",
      "Backlog two",
    ]);
  });
});

describe("a restricted agent's sub-tasks (WS-138 test 6)", () => {
  it("reads its project's parent with its sub-tasks, and gets 403 for another project's", async () => {
    const s = await setup();
    await sub(s, "Card form");
    const webParent = await createTask(s.mia, "WEB", { title: "Landing page" });
    await createTask(s.mia, "WEB", { title: "Hero", parentId: webParent.key });
    const account = await createTestAgent({
      name: "Restricted",
      role: "worker_agent",
      scopes: ["tasks:read", "tasks:write"],
      projectIds: [s.parent.projectId],
    });
    const agent = agentActor({
      accountId: account.id,
      role: "worker_agent",
      scopes: ["tasks:read", "tasks:write"],
      projectIds: [s.parent.projectId],
    });

    const parent = await getTask(agent, s.parent.key);
    expect(parent.subtasks).toEqual({ done: 0, total: 1 });
    expect(parent.subtaskList.map((task) => task.title)).toEqual(["Card form"]);
    expect((await failure(getTask(agent, webParent.key))).status).toBe(403);
  });
});

describe("the limit (WS-133 test 8)", () => {
  it("refuses a 101st live sub-task with 409 too_many_subtasks; a deleted one frees a place", async () => {
    const s = await setup();
    const children = [];
    for (let n = 0; n < 100; n += 1) children.push(await sub(s, `Child ${String(n)}`));

    const error = await failure(sub(s, "One too many"));
    expect(error.status).toBe(409);
    expect(error.code).toBe("too_many_subtasks");

    const first = children[0];
    if (!first) throw new Error("no child");
    await deleteTask(s.manager, first.key);
    expect((await sub(s, "Now it fits")).parent?.id).toBe(s.parent.id);
    // A hundred and two task writes, each a transaction of its own.
  }, 60_000);
});

describe("deleting a parent (WS-133 test 9)", () => {
  it("is 409 has_subtasks while it has live ones, and works once they are gone", async () => {
    const s = await setup();
    const kept = await sub(s, "Kept");
    const dropped = await sub(s, "Dropped");

    const error = await failure(deleteTask(s.manager, s.parent.key));
    expect(error.status).toBe(409);
    expect(error.code).toBe("has_subtasks");

    await deleteTask(s.manager, dropped.key);
    await updateTask(s.mia, kept.key, { parentId: null, version: kept.version });
    await deleteTask(s.manager, s.parent.key);
    expect((await failure(getTask(s.mia, s.parent.key))).status).toBe(404);
  });
});

describe("restoring a sub-task (WS-133 test 10)", () => {
  it("makes it a normal task when its parent is deleted, with its history entry", async () => {
    const s = await setup();
    const child = await sub(s, "Child");
    await deleteTask(s.manager, child.key);
    await deleteTask(s.manager, s.parent.key);

    const restored = await restoreTask(s.manager, child.key);

    expect(restored.parent).toBeNull();
    const last = (await historyOf(child.id)).filter((entry) => entry.field === "parentId").at(-1);
    expect([last?.oldValue, last?.newValue]).toEqual([s.parent.id, null]);
  });

  it("keeps its parent when the parent is live", async () => {
    const s = await setup();
    const child = await sub(s, "Child");
    await deleteTask(s.manager, child.key);

    expect((await restoreTask(s.manager, child.key)).parent?.id).toBe(s.parent.id);
  });
});

describe("events for the parent (WS-133 test 11)", () => {
  function updatedIds(events: ProjectEvent[]): string[] {
    return events.filter((event) => event.type === "task.updated").map((event) => event.entityId);
  }

  it("announces the parent on attach, create, move, delete and detach", async () => {
    const s = await setup();
    const other = await createTask(s.mia, "OPA", { title: "Other parent" });
    const loose = await createTask(s.mia, "OPA", { title: "Loose" });

    const attach = await eventsOf(() =>
      updateTask(s.mia, loose.key, { parentId: s.parent.key, version: loose.version }),
    );
    expect(updatedIds(attach)).toEqual(expect.arrayContaining([loose.id, s.parent.id]));

    const moveParent = await eventsOf(async () =>
      updateTask(s.mia, loose.key, { parentId: other.key, version: await version(s, loose.key) }),
    );
    expect(updatedIds(moveParent)).toEqual(
      expect.arrayContaining([loose.id, s.parent.id, other.id]),
    );

    let created = { key: "", id: "" };
    const create = await eventsOf(async () => {
      created = await sub(s, "New child");
    });
    expect(updatedIds(create)).toContain(s.parent.id);

    const toDone = await eventsOf(async () =>
      moveTask(s.mia, created.key, { columnId: s.done.id, version: await version(s, created.key) }),
    );
    expect(updatedIds(toDone)).toContain(s.parent.id);

    const removed = await eventsOf(() => deleteTask(s.manager, created.key));
    expect(updatedIds(removed)).toContain(s.parent.id);

    const detach = await eventsOf(async () =>
      updateTask(s.mia, loose.key, { parentId: null, version: await version(s, loose.key) }),
    );
    expect(updatedIds(detach)).toEqual(expect.arrayContaining([loose.id, other.id]));
  });

  it("does not announce a parent for a move within one column category", async () => {
    const s = await setup();
    const child = await sub(s, "Child");

    const within = await eventsOf(() =>
      moveTask(s.mia, child.key, { columnId: s.todo.id, version: child.version }),
    );

    expect(within.map((event) => event.entityId)).not.toContain(s.parent.id);
  });
});
