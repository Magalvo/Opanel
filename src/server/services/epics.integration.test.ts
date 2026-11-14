import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createTestAccount, failAuditFor, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { auditLog, taskEvents } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

import { listColumns } from "./columns";
import { createEpic, getEpic, listEpics, updateEpic } from "./epics";
import { archiveProject, createProject } from "./projects";
import { createTask, deleteTask, getTask, listTasks, moveTask, updateTask } from "./tasks";

async function setup() {
  const managerAccount = await createTestAccount({ email: "manager@example.com", role: "manager" });
  const manager = testActor(managerAccount);
  const member = testActor(await createTestAccount({ email: "mia@example.com", role: "member" }));
  const project = await createProject(manager, { key: "OPA", name: "Opanel" });
  const columns = (await listColumns(manager, "OPA")).items.map((column) => column.id);
  return { manager, managerAccount, member, project, columns };
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

async function audits() {
  return getDb().select().from(auditLog).orderBy(auditLog.id);
}

describe("epics table", () => {
  it("refuses a target date before the start date", async () => {
    const { project } = await setup();

    await expect(
      getDb().execute(sql`
        insert into epics (project_id, title, start_date, target_date)
        values (${project.id}, 'E', '2026-12-01', '2026-11-01')`),
    ).rejects.toThrow();
  });
});

describe("createEpic", () => {
  it("creates an open epic with no progress and records epic.created", async () => {
    const { manager, managerAccount, project } = await setup();

    const epic = await createEpic(manager, "OPA", { title: "Sign-in", targetDate: "2026-12-15" });

    expect(epic).toMatchObject({
      projectId: project.id,
      title: "Sign-in",
      description: "",
      status: "open",
      startDate: null,
      targetDate: "2026-12-15",
      progress: { doneTasks: 0, totalTasks: 0 },
      version: 1,
    });
    expect((await audits()).at(-1)).toMatchObject({
      actorAccountId: managerAccount.id,
      action: "epic.created",
      entity: "epic",
      entityId: epic.id,
      data: { projectId: project.id, title: "Sign-in" },
    });
  });

  it("is refused to a Member and in an archived project", async () => {
    const { manager, member } = await setup();

    expect((await failure(createEpic(member, "OPA", { title: "E" }))).status).toBe(403);
    await archiveProject(manager, "OPA");
    expect((await failure(createEpic(manager, "OPA", { title: "E" }))).code).toBe(
      "project_archived",
    );
  });
});

describe("updateEpic", () => {
  it("records changed fields, closing and reopening, and detects stale versions", async () => {
    const { manager } = await setup();
    const epic = await createEpic(manager, "OPA", { title: "E", startDate: "2026-11-01" });

    const edited = await updateEpic(manager, epic.id, {
      title: "Epic",
      targetDate: "2026-12-01",
      version: 1,
    });
    const closed = await updateEpic(manager, epic.id, { status: "closed", version: 2 });
    const reopened = await updateEpic(manager, epic.id, {
      status: "open",
      description: "Back",
      version: 3,
    });

    expect(edited).toMatchObject({ title: "Epic", targetDate: "2026-12-01", version: 2 });
    expect(closed.status).toBe("closed");
    expect(reopened).toMatchObject({ status: "open", version: 4 });
    expect((await audits()).map((entry) => [entry.action, entry.data])).toEqual([
      ["epic.created", expect.anything()],
      ["epic.updated", { projectId: epic.projectId, changed: ["title", "targetDate"] }],
      ["epic.closed", { projectId: epic.projectId }],
      ["epic.updated", { projectId: epic.projectId, changed: ["description"] }],
      ["epic.reopened", { projectId: epic.projectId }],
    ]);

    const stale = await failure(updateEpic(manager, epic.id, { title: "Old", version: 1 }));
    expect(stale.code).toBe("version_conflict");
    expect(stale.current).toEqual(reopened);
  });

  it("checks the dates as they will be after the change", async () => {
    const { manager } = await setup();
    const epic = await createEpic(manager, "OPA", { title: "E", startDate: "2026-11-15" });

    const error = await failure(
      updateEpic(manager, epic.id, { targetDate: "2026-11-01", version: 1 }),
    );

    expect(error.status).toBe(400);
    expect(error.errors?.map((field) => field.path)).toEqual(["targetDate"]);
    expect(
      (await updateEpic(manager, epic.id, { startDate: null, version: 1 })).startDate,
    ).toBeNull();
  });

  it("answers 404 for an unknown epic, 403 to a Member, and project_archived when archived", async () => {
    const { manager, member } = await setup();
    const epic = await createEpic(manager, "OPA", { title: "E" });

    expect(
      (
        await failure(
          updateEpic(manager, "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f", { title: "X", version: 1 }),
        )
      ).status,
    ).toBe(404);
    expect((await failure(updateEpic(member, epic.id, { title: "X", version: 1 }))).status).toBe(
      403,
    );
    await archiveProject(manager, "OPA");
    expect((await failure(updateEpic(manager, epic.id, { title: "X", version: 1 }))).code).toBe(
      "project_archived",
    );
  });

  it("rolls back when the audit write fails", async () => {
    const { manager } = await setup();
    const epic = await createEpic(manager, "OPA", { title: "E" });
    const restore = await failAuditFor("epic.updated");
    try {
      await expect(updateEpic(manager, epic.id, { title: "Lost", version: 1 })).rejects.toThrow();
    } finally {
      await restore();
    }

    expect(await getEpic(manager, epic.id)).toMatchObject({ title: "E", version: 1 });
  });
});

describe("progress", () => {
  it("counts live tasks, done when their column is in the done category", async () => {
    const { manager, member, columns } = await setup();
    const epic = await createEpic(manager, "OPA", { title: "E" });
    await createTask(member, "OPA", { title: "A", epicId: epic.id });
    await createTask(member, "OPA", { title: "B", epicId: epic.id, columnId: columns[2] ?? "" });
    await createTask(member, "OPA", { title: "C", epicId: epic.id });
    await createTask(member, "OPA", { title: "Not in it" });
    await deleteTask(member, "OPA-3");

    expect((await getEpic(member, epic.id)).progress).toEqual({ doneTasks: 1, totalTasks: 2 });
    await moveTask(member, "OPA-1", { columnId: columns[2] ?? "", version: 1 });
    expect((await getEpic(member, epic.id)).progress).toEqual({ doneTasks: 2, totalTasks: 2 });
    expect((await listEpics(member, "OPA", { limit: 50 })).items[0]?.progress).toEqual({
      doneTasks: 2,
      totalTasks: 2,
    });
  });
});

describe("listEpics", () => {
  it("lists open epics by default, closed or all on request, by title ignoring case", async () => {
    const { manager, member } = await setup();
    for (const title of ["delta", "Alpha", "charlie", "Bravo"]) {
      await createEpic(manager, "OPA", { title });
    }
    const old = await createEpic(manager, "OPA", { title: "Old" });
    await updateEpic(manager, old.id, { status: "closed", version: 1 });

    const first = await listEpics(member, "OPA", { limit: 3 });
    const second = await listEpics(member, "OPA", { limit: 3, cursor: first.nextCursor ?? "" });
    const titles = async (status: "open" | "closed" | "all") =>
      (await listEpics(member, "OPA", { limit: 50, status })).items.map((epic) => epic.title);

    expect([...first.items, ...second.items].map((epic) => epic.title)).toEqual([
      "Alpha",
      "Bravo",
      "charlie",
      "delta",
    ]);
    expect(second.nextCursor).toBeNull();
    expect(await titles("closed")).toEqual(["Old"]);
    expect(await titles("all")).toEqual(["Alpha", "Bravo", "charlie", "delta", "Old"]);
    expect((await failure(listEpics(member, "NOPE", { limit: 50 }))).status).toBe(404);
  });
});

describe("a task's epic", () => {
  it("is set on create, changed and cleared with PATCH, each a field_changed on epicId", async () => {
    const { manager, member } = await setup();
    const first = await createEpic(manager, "OPA", { title: "First" });
    const second = await createEpic(manager, "OPA", { title: "Second" });
    const closed = await createEpic(manager, "OPA", { title: "Closed" });
    await updateEpic(manager, closed.id, { status: "closed", version: 1 });

    const task = await createTask(member, "OPA", { title: "T", epicId: first.id });
    expect(task.epic).toEqual({ id: first.id, title: "First" });
    await updateTask(member, "OPA-1", { epicId: second.id, version: 1 });
    await updateTask(member, "OPA-1", { epicId: null, version: 2 });
    await updateTask(member, "OPA-1", { epicId: closed.id, version: 3 });

    expect((await getTask(member, "OPA-1")).epic).toEqual({ id: closed.id, title: "Closed" });
    expect((await listTasks(member, "OPA", { limit: 50 })).items[0]?.epic?.id).toBe(closed.id);
    const changes = await getDb()
      .select()
      .from(taskEvents)
      .where(eq(taskEvents.taskId, task.id))
      .then((rows) => rows.filter((row) => row.field === "epicId"));
    expect(changes.map((event) => [event.oldValue, event.newValue])).toEqual([
      [first.id, second.id],
      [second.id, null],
      [null, closed.id],
    ]);
  });

  it("must be an epic of the task's project", async () => {
    const { manager, member } = await setup();
    await createProject(manager, { key: "WEB", name: "Web" });
    const other = await createEpic(manager, "WEB", { title: "Elsewhere" });
    await createTask(member, "OPA", { title: "T" });

    for (const attempt of [
      () => createTask(member, "OPA", { title: "X", epicId: other.id }),
      () => updateTask(member, "OPA-1", { epicId: other.id, version: 1 }),
    ]) {
      expect((await failure(attempt())).errors?.map((field) => field.path)).toEqual(["epicId"]);
    }
  });
});
