// Priority and due date on tasks (WS-102).
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { taskSchema } from "@/lib/schemas/tasks";
import { createTestAccount, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { taskEvents, tasks } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

import { listColumns } from "./columns";
import { createProject } from "./projects";
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
  const [todo, progress] = (await listColumns(manager, "OPA")).items.map((column) => column.id);
  if (!todo || !progress) throw new Error("no columns");
  return { manager, member, actor, project, todo, progress };
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

async function history(taskId: string) {
  return getDb()
    .select()
    .from(taskEvents)
    .where(eq(taskEvents.taskId, taskId))
    .orderBy(taskEvents.id);
}

describe("the priority and due date columns", () => {
  it("give a task written without them priority none and no due date", async () => {
    const { actor, member, project, todo } = await setup();
    await getDb().execute(sql`
      insert into tasks (project_id, number, title, column_id, position, reporter_account_id)
      values (${project.id}, 1, 'Old', ${todo}, 'a0', ${member.id})`);

    const task = await getTask(actor, "OPA-1");

    expect(task).toMatchObject({ priority: "none", dueDate: null });
  });

  it("refuses a priority outside the five", async () => {
    const { actor } = await setup();
    const task = await createTask(actor, "OPA", { title: "T" });

    await expect(
      getDb().execute(sql`update tasks set priority = 'critical' where id = ${task.id}`),
    ).rejects.toThrow(/tasks_priority_check/);
  });
});

describe("createTask with priority and due date", () => {
  it("answers them and names them in the created entry; without them, none and null", async () => {
    const { actor } = await setup();

    const set = await createTask(actor, "OPA", {
      title: "Set",
      priority: "high",
      dueDate: "2026-12-01",
    });
    const plain = await createTask(actor, "OPA", { title: "Plain" });

    expect(set).toMatchObject({ priority: "high", dueDate: "2026-12-01" });
    expect(plain).toMatchObject({ priority: "none", dueDate: null });
    const [createdSet] = await history(set.id);
    expect(createdSet?.newValue).toMatchObject({ priority: "high", dueDate: "2026-12-01" });
    const [createdPlain] = await history(plain.id);
    expect(Object.keys(createdPlain?.newValue as object)).not.toContain("priority");
    expect(Object.keys(createdPlain?.newValue as object)).not.toContain("dueDate");
  });

  it("accepts a due date in the past", async () => {
    const { actor } = await setup();

    const task = await createTask(actor, "OPA", { title: "Late", dueDate: "2020-01-01" });

    expect(task.dueDate).toBe("2020-01-01");
  });
});

describe("updateTask with priority and due date", () => {
  it("sets, changes and clears each, one field_changed entry per change, one version per PATCH", async () => {
    const { actor, member } = await setup();
    const task = await createTask(actor, "OPA", { title: "T" });

    const first = await updateTask(actor, task.key, {
      priority: "high",
      dueDate: "2026-12-01",
      version: 1,
    });
    const second = await updateTask(actor, task.key, { priority: "urgent", version: 2 });
    const third = await updateTask(actor, task.key, { dueDate: "2020-01-01", version: 3 });
    const fourth = await updateTask(actor, task.key, {
      priority: "none",
      dueDate: null,
      version: 4,
    });

    expect([first, second, third, fourth].map((each) => [each.version, each.priority])).toEqual([
      [2, "high"],
      [3, "urgent"],
      [4, "urgent"],
      [5, "none"],
    ]);
    expect([first, second, third, fourth].map((each) => each.dueDate)).toEqual([
      "2026-12-01",
      "2026-12-01",
      "2020-01-01",
      null,
    ]);
    const changes = (await history(task.id)).filter((event) => event.type === "field_changed");
    expect(
      changes.map((event) => [event.field, event.oldValue, event.newValue, event.actorAccountId]),
    ).toEqual([
      ["priority", "none", "high", member.id],
      ["dueDate", null, "2026-12-01", member.id],
      ["priority", "high", "urgent", member.id],
      ["dueDate", "2026-12-01", "2020-01-01", member.id],
      ["priority", "urgent", "none", member.id],
      ["dueDate", "2020-01-01", null, member.id],
    ]);
  });

  it("records nothing for a value sent unchanged", async () => {
    const { actor } = await setup();
    const task = await createTask(actor, "OPA", { title: "T", priority: "low" });

    await updateTask(actor, task.key, { priority: "low", version: 1 });

    const changes = (await history(task.id)).filter((event) => event.type === "field_changed");
    expect(changes).toEqual([]);
  });
});

describe("every answer carries priority and due date", () => {
  it("get, the board list, the backlog, move, restore and a 409's current", async () => {
    const { actor, manager, progress } = await setup();
    const fields = { priority: "high", dueDate: "2026-12-01" } as const;
    const onBoard = await createTask(actor, "OPA", { title: "Board", ...fields });
    await createTask(actor, "OPA", { title: "Backlog", columnId: null, ...fields });

    expect(await getTask(actor, onBoard.key)).toMatchObject(fields);
    expect((await listTasks(actor, "OPA", { limit: 50 })).items).toEqual([
      expect.objectContaining(fields),
    ]);
    expect((await listBacklog(actor, "OPA", { limit: 50 })).items).toEqual([
      expect.objectContaining(fields),
    ]);
    const moved = await moveTask(actor, onBoard.key, { columnId: progress, version: 1 });
    expect(moved).toMatchObject(fields);

    await deleteTask(manager, onBoard.key);
    expect(await restoreTask(manager, onBoard.key)).toMatchObject(fields);

    const conflict = await failure(updateTask(actor, onBoard.key, { priority: "low", version: 1 }));
    expect(conflict.status).toBe(409);
    expect(taskSchema.parse(conflict.current)).toMatchObject(fields);
    const [row] = await getDb().select().from(tasks).where(eq(tasks.id, onBoard.id));
    expect(row).toMatchObject({ priority: "high", dueDate: "2026-12-01" });
  });
});
