import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createTestAccount, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { taskEvents, tasks } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

import { createColumn, deleteColumn, listColumns } from "./columns";
import { archiveProject, createProject } from "./projects";
import { createTask, deleteTask, getTask, listTasks, restoreTask } from "./tasks";
import { createTeam, deleteTeam } from "./teams";

async function setup() {
  const managerAccount = await createTestAccount({ email: "manager@example.com", role: "manager" });
  const manager = testActor(managerAccount);
  const mia = await createTestAccount({ name: "Mia", email: "mia@example.com", role: "member" });
  const member = testActor(mia);
  const other = testActor(await createTestAccount({ email: "max@example.com", role: "member" }));
  await createProject(manager, { key: "OPA", name: "Opanel" });
  const columns = (await listColumns(manager, "OPA")).items.map((column) => column.id);
  return { manager, managerAccount, member, mia, other, columns };
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

async function eventTypes(taskId: string) {
  const rows = await getDb()
    .select()
    .from(taskEvents)
    .where(eq(taskEvents.taskId, taskId))
    .orderBy(taskEvents.id);
  return rows;
}

describe("deleteTask", () => {
  it("hides the task, records deleted with the actor and bumps version", async () => {
    const { member, mia } = await setup();
    const task = await createTask(member, "OPA", { title: "A" });

    await deleteTask(member, "OPA-1");

    expect((await listTasks(member, "OPA", { limit: 50 })).items).toEqual([]);
    expect((await failure(getTask(member, task.id))).status).toBe(404);
    expect((await failure(getTask(member, "OPA-1"))).status).toBe(404);
    expect((await failure(deleteTask(member, "OPA-1"))).status).toBe(404);
    const [row] = await getDb().select().from(tasks).where(eq(tasks.id, task.id));
    expect(row).toMatchObject({ version: 2, deletedBy: mia.id });
    expect(row?.deletedAt).not.toBeNull();
    expect((await eventTypes(task.id)).at(-1)).toMatchObject({
      type: "deleted",
      actorAccountId: mia.id,
      field: null,
      oldValue: null,
      newValue: null,
    });
  });

  it("lets a Member delete only their own tasks, a Manager any, and a Viewer none", async () => {
    const { manager, member, other } = await setup();
    await createTask(member, "OPA", { title: "Mine" });
    await createTask(other, "OPA", { title: "Theirs" });
    await createTask(other, "OPA", { title: "Also theirs" });
    const viewer = testActor(await createTestAccount({ email: "v@example.com", role: "viewer" }));

    expect((await failure(deleteTask(member, "OPA-2"))).status).toBe(403);
    expect((await failure(deleteTask(viewer, "OPA-1"))).status).toBe(403);
    await deleteTask(member, "OPA-1");
    await deleteTask(manager, "OPA-2");

    expect((await listTasks(member, "OPA", { limit: 50 })).items.map((task) => task.key)).toEqual([
      "OPA-3",
    ]);
  });
});

describe("the deleted list", () => {
  it("shows only deleted tasks, with deletedAt, to Managers and Admins", async () => {
    const { manager, member } = await setup();
    await createTask(member, "OPA", { title: "Kept" });
    await createTask(member, "OPA", { title: "Gone" });
    await deleteTask(member, "OPA-2");

    const deleted = await listTasks(manager, "OPA", { limit: 50, deleted: "true" });
    const live = await listTasks(manager, "OPA", { limit: 50 });

    expect(deleted.items.map((task) => task.key)).toEqual(["OPA-2"]);
    expect(deleted.items[0]?.deletedAt).not.toBeNull();
    expect(live.items.map((task) => [task.key, task.deletedAt])).toEqual([["OPA-1", null]]);
    expect((await failure(listTasks(member, "OPA", { limit: 50, deleted: "true" }))).status).toBe(
      403,
    );
  });
});

describe("restoreTask", () => {
  it("brings the task back in place with its key, records restored, and does nothing for a live task", async () => {
    const { manager, managerAccount, member, columns } = await setup();
    await createTask(member, "OPA", { title: "A" });
    await createTask(member, "OPA", { title: "B" });
    await createTask(member, "OPA", { title: "C" });
    await deleteTask(member, "OPA-2");

    const restored = await restoreTask(manager, "OPA-2");

    expect(restored).toMatchObject({
      key: "OPA-2",
      columnId: columns[0],
      deletedAt: null,
      version: 3,
    });
    expect((await listTasks(member, "OPA", { limit: 50 })).items.map((task) => task.key)).toEqual([
      "OPA-1",
      "OPA-2",
      "OPA-3",
    ]);
    expect((await eventTypes(restored.id)).at(-1)).toMatchObject({
      type: "restored",
      actorAccountId: managerAccount.id,
    });

    const again = await restoreTask(manager, "OPA-2");
    expect(again).toEqual(restored);
    expect((await eventTypes(restored.id)).map((event) => event.type)).toEqual([
      "created",
      "deleted",
      "restored",
    ]);
  });

  it("needs tasks:delete_any and answers 404 for an unknown task", async () => {
    const { manager, member } = await setup();
    await createTask(member, "OPA", { title: "A" });
    await deleteTask(member, "OPA-1");

    expect((await failure(restoreTask(member, "OPA-1"))).status).toBe(403);
    expect((await failure(restoreTask(manager, "OPA-9"))).status).toBe(404);
  });
});

describe("archived projects", () => {
  it("refuse delete and restore", async () => {
    const { manager, member } = await setup();
    await createTask(member, "OPA", { title: "A" });
    await createTask(member, "OPA", { title: "B" });
    await deleteTask(member, "OPA-2");
    await archiveProject(manager, "OPA");

    expect((await failure(deleteTask(member, "OPA-1"))).code).toBe("project_archived");
    expect((await failure(restoreTask(manager, "OPA-2"))).code).toBe("project_archived");
  });
});

describe("deleted tasks and the column and team rules", () => {
  it("lets a column holding only deleted tasks be deleted, moving them to the first column in order", async () => {
    const { manager, member, managerAccount, columns } = await setup();
    const review = await createColumn(manager, "OPA", { name: "Review", category: "in_progress" });
    await createTask(member, "OPA", { title: "Live", columnId: review.id });
    await createTask(member, "OPA", { title: "Old 1", columnId: review.id });
    await createTask(member, "OPA", { title: "Old 2", columnId: review.id });
    await createTask(member, "OPA", { title: "First column" });
    await deleteTask(member, "OPA-2");
    await deleteTask(member, "OPA-3");

    expect((await failure(deleteColumn(manager, review.id))).code).toBe("column_not_empty");

    await deleteTask(member, "OPA-1");
    await deleteColumn(manager, review.id);

    const deleted = await listTasks(manager, "OPA", { limit: 50, deleted: "true" });
    expect(deleted.items.map((task) => [task.key, task.columnId])).toEqual([
      ["OPA-1", columns[0]],
      ["OPA-2", columns[0]],
      ["OPA-3", columns[0]],
    ]);
    const old = deleted.items.find((task) => task.key === "OPA-2");
    expect((await eventTypes(old?.id ?? "")).at(-1)).toMatchObject({
      type: "moved",
      actorAccountId: managerAccount.id,
      oldValue: { columnId: review.id },
      newValue: { columnId: columns[0] },
    });

    await restoreTask(manager, "OPA-2");
    expect((await listTasks(member, "OPA", { limit: 50 })).items.map((task) => task.key)).toEqual([
      "OPA-4",
      "OPA-2",
    ]);
  });

  it("keeps a team undeletable while a deleted task is assigned to it", async () => {
    const { manager, member } = await setup();
    const team = await createTeam(manager, { name: "Frontend" });
    await createTask(member, "OPA", { title: "A", assigneeTeamId: team.id });
    await deleteTask(member, "OPA-1");

    const error = await failure(deleteTeam(manager, team.id));

    expect(error.code).toBe("team_in_use");
    expect(error.detail).toContain("deleted");
  });

  it("puts a new task after the deleted ones of its column", async () => {
    const { member } = await setup();
    await createTask(member, "OPA", { title: "A" });
    await deleteTask(member, "OPA-1");

    await createTask(member, "OPA", { title: "B" });

    const positions = await getDb().select({ position: tasks.position }).from(tasks);
    expect(new Set(positions.map((row) => row.position)).size).toBe(2);
  });
});
