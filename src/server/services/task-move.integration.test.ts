import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createTestAccount, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { taskEvents, tasks } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

import { listColumns } from "./columns";
import { archiveProject, createProject } from "./projects";
import { createTask, getTask, listTasks, moveTask } from "./tasks";

async function setup() {
  const manager = testActor(
    await createTestAccount({ email: "manager@example.com", role: "manager" }),
  );
  const member = await createTestAccount({ name: "Mia", email: "mia@example.com", role: "member" });
  const actor = testActor(member);
  await createProject(manager, { key: "OPA", name: "Opanel" });
  const [todo, progress, done] = (await listColumns(manager, "OPA")).items.map(
    (column) => column.id,
  );
  if (!todo || !progress || !done) throw new Error("no columns");
  return { manager, member, actor, todo, progress, done };
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

/** Task keys of a column, in board order. */
async function column(actor: Awaited<ReturnType<typeof setup>>["actor"], columnId: string) {
  return (await listTasks(actor, "OPA", { limit: 100, columnId })).items.map((task) => task.key);
}

async function movedEvents(taskId: string) {
  return getDb()
    .select()
    .from(taskEvents)
    .where(eq(taskEvents.taskId, taskId))
    .then((rows) => rows.filter((row) => row.type === "moved"));
}

describe("moveTask: place", () => {
  it("moves to the end of a column, right after a task and right before the first task", async () => {
    const { actor, todo, progress } = await setup();
    const a = await createTask(actor, "OPA", { title: "A" });
    const b = await createTask(actor, "OPA", { title: "B", columnId: progress });
    const c = await createTask(actor, "OPA", { title: "C", columnId: progress });
    await createTask(actor, "OPA", { title: "D" });

    const moved = await moveTask(actor, "OPA-1", { columnId: progress, version: 1 });
    expect(moved).toMatchObject({ key: "OPA-1", columnId: progress, version: 2 });
    expect(await column(actor, progress)).toEqual(["OPA-2", "OPA-3", "OPA-1"]);

    await moveTask(actor, a.id, { columnId: progress, afterTaskId: b.id, version: 2 });
    expect(await column(actor, progress)).toEqual(["OPA-2", "OPA-1", "OPA-3"]);

    await moveTask(actor, "OPA-4", { columnId: progress, beforeTaskId: b.id, version: 1 });
    expect(await column(actor, progress)).toEqual(["OPA-4", "OPA-2", "OPA-1", "OPA-3"]);
    expect(await column(actor, todo)).toEqual([]);
    expect(c.columnId).toBe(progress);
  });
});

describe("moveTask: within a column", () => {
  it("reorders without a moved event; its own place keeps the position and bumps version", async () => {
    const { actor, todo } = await setup();
    const a = await createTask(actor, "OPA", { title: "A" });
    const b = await createTask(actor, "OPA", { title: "B" });
    await createTask(actor, "OPA", { title: "C" });

    await moveTask(actor, "OPA-3", { columnId: todo, beforeTaskId: a.id, version: 1 });
    expect(await column(actor, todo)).toEqual(["OPA-3", "OPA-1", "OPA-2"]);
    await moveTask(actor, "OPA-3", { columnId: todo, version: 2 });
    expect(await column(actor, todo)).toEqual(["OPA-1", "OPA-2", "OPA-3"]);

    const [before] = await getDb().select().from(tasks).where(eq(tasks.id, b.id));
    const same = await moveTask(actor, "OPA-2", { columnId: todo, afterTaskId: a.id, version: 1 });
    const [after] = await getDb().select().from(tasks).where(eq(tasks.id, b.id));

    expect(same.version).toBe(2);
    expect(after?.position).toBe(before?.position);
    expect(await movedEvents(a.id)).toEqual([]);
    expect(await movedEvents(b.id)).toEqual([]);
  });
});

describe("moveTask: history", () => {
  it("records one moved event with the old and new column and the actor", async () => {
    const { actor, member, todo, done } = await setup();
    const task = await createTask(actor, "OPA", { title: "A" });

    await moveTask(actor, task.id, { columnId: done, version: 1 });

    expect(await movedEvents(task.id)).toEqual([
      expect.objectContaining({
        actorAccountId: member.id,
        field: null,
        oldValue: { columnId: todo },
        newValue: { columnId: done },
      }),
    ]);
  });
});

describe("moveTask: errors", () => {
  it("refuses bad anchors and a column of another project with 400, and answers 404 and version_conflict", async () => {
    const { actor, manager, todo, progress } = await setup();
    const a = await createTask(actor, "OPA", { title: "A" });
    const b = await createTask(actor, "OPA", { title: "B", columnId: progress });
    const gone = await createTask(actor, "OPA", { title: "Gone" });
    await getDb().update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, gone.id));
    await createProject(manager, { key: "WEB", name: "Web" });
    const [webColumn] = (await listColumns(manager, "WEB")).items;

    const paths = async (promise: Promise<unknown>) =>
      (await failure(promise)).errors?.map((field) => field.path);

    expect(
      await paths(moveTask(actor, "OPA-1", { columnId: todo, afterTaskId: b.id, version: 1 })),
    ).toEqual(["afterTaskId"]);
    expect(
      await paths(moveTask(actor, "OPA-1", { columnId: todo, beforeTaskId: gone.id, version: 1 })),
    ).toEqual(["beforeTaskId"]);
    expect(
      await paths(moveTask(actor, "OPA-1", { columnId: todo, afterTaskId: a.id, version: 1 })),
    ).toEqual(["afterTaskId"]);
    expect(
      await paths(moveTask(actor, "OPA-1", { columnId: webColumn?.id ?? "", version: 1 })),
    ).toEqual(["columnId"]);
    expect((await failure(moveTask(actor, "OPA-9", { columnId: todo, version: 1 }))).status).toBe(
      404,
    );

    const current = await moveTask(actor, "OPA-1", { columnId: progress, version: 1 });
    const stale = await failure(moveTask(actor, "OPA-1", { columnId: todo, version: 1 }));
    expect(stale.code).toBe("version_conflict");
    expect(stale.current).toEqual(current);
  });

  it("is refused in an archived project and to a Viewer", async () => {
    const { actor, manager, done } = await setup();
    await createTask(actor, "OPA", { title: "A" });
    const viewer = testActor(await createTestAccount({ email: "v@example.com", role: "viewer" }));

    expect((await failure(moveTask(viewer, "OPA-1", { columnId: done, version: 1 }))).status).toBe(
      403,
    );
    await archiveProject(manager, "OPA");
    expect((await failure(moveTask(actor, "OPA-1", { columnId: done, version: 1 }))).code).toBe(
      "project_archived",
    );
  });
});

describe("moveTask: concurrency", () => {
  it("lets ten moves and ten creations into one column all succeed with distinct positions", async () => {
    const { actor, done } = await setup();
    const moving = [];
    for (let index = 0; index < 10; index += 1) {
      moving.push(await createTask(actor, "OPA", { title: `M${String(index)}` }));
    }

    await Promise.all([
      ...moving.map((task) => moveTask(actor, task.id, { columnId: done, version: 1 })),
      ...Array.from({ length: 10 }, (_, index) =>
        createTask(actor, "OPA", { title: `N${String(index)}`, columnId: done }),
      ),
    ]);

    expect(await column(actor, done)).toHaveLength(20);
    const [{ count } = { count: 0 }] = await getDb().execute<{ count: number }>(
      sql`select count(distinct position)::int as count from tasks where column_id = ${done}`,
    );
    expect(count).toBe(20);
  });

  it("lets two moves right after the same task both succeed", async () => {
    const { actor, todo, progress } = await setup();
    const anchor = await createTask(actor, "OPA", { title: "Anchor", columnId: progress });
    const x = await createTask(actor, "OPA", { title: "X", columnId: todo });
    const y = await createTask(actor, "OPA", { title: "Y", columnId: todo });

    await Promise.all([
      moveTask(actor, x.id, { columnId: progress, afterTaskId: anchor.id, version: 1 }),
      moveTask(actor, y.id, { columnId: progress, afterTaskId: anchor.id, version: 1 }),
    ]);

    const keys = await column(actor, progress);
    expect(keys[0]).toBe("OPA-1");
    expect([...keys].sort()).toEqual(["OPA-1", "OPA-2", "OPA-3"]);
    expect((await getTask(actor, x.id)).columnId).toBe(progress);
  });
});
