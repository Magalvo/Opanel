import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createTestAccount, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { accounts, taskEvents, tasks } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

import { createColumn, deleteColumn, listColumns, moveColumn } from "./columns";
import { archiveProject, createProject } from "./projects";
import { createTask, getTask, listTasks, updateTask } from "./tasks";
import { addTeamMember, createTeam, deleteTeam } from "./teams";

const UNKNOWN = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";

async function setup() {
  const manager = await createTestAccount({
    name: "Manager",
    email: "manager@example.com",
    role: "manager",
  });
  const member = await createTestAccount({ name: "Mia", email: "mia@example.com", role: "member" });
  const managerActor = testActor(manager);
  const actor = testActor(member);
  const project = await createProject(managerActor, { key: "OPA", name: "Opanel" });
  const columns = (await listColumns(managerActor, "OPA")).items;
  return { manager, managerActor, member, actor, project, columns };
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

async function eventsOf(taskId: string) {
  return getDb()
    .select()
    .from(taskEvents)
    .where(eq(taskEvents.taskId, taskId))
    .orderBy(taskEvents.id);
}

describe("createTask", () => {
  it("numbers tasks per project, puts them at the end of the first column, and records created", async () => {
    const { actor, member, project, columns } = await setup();

    const first = await createTask(actor, "OPA", { title: "First" });
    const second = await createTask(actor, project.id, { title: "Second", type: "bug" });

    expect(first).toMatchObject({
      key: "OPA-1",
      number: 1,
      projectId: project.id,
      type: "task",
      title: "First",
      description: "",
      columnId: columns[0]?.id,
      assigneeTeam: null,
      assignee: null,
      reporter: { id: member.id, name: "Mia" },
      version: 1,
    });
    expect(second).toMatchObject({ key: "OPA-2", type: "bug" });
    expect((await listTasks(actor, "OPA", { limit: 50 })).items.map((task) => task.key)).toEqual([
      "OPA-1",
      "OPA-2",
    ]);
    expect(await eventsOf(first.id)).toEqual([
      expect.objectContaining({
        actorAccountId: member.id,
        type: "created",
        field: null,
        oldValue: null,
        newValue: { key: "OPA-1", type: "task", title: "First", columnId: columns[0]?.id },
      }),
    ]);
  });

  it("creates in a given column of the project, and refuses a column of another project", async () => {
    const { actor, managerActor, columns } = await setup();
    await createProject(managerActor, { key: "WEB", name: "Web" });
    const [webColumn] = (await listColumns(managerActor, "WEB")).items;

    const task = await createTask(actor, "OPA", {
      title: "Done already",
      columnId: columns[2]?.id ?? "",
    });
    const error = await failure(
      createTask(actor, "OPA", { title: "X", columnId: webColumn?.id ?? "" }),
    );

    expect(task.columnId).toBe(columns[2]?.id);
    expect(error.status).toBe(400);
    expect(error.errors?.map((field) => field.path)).toEqual(["columnId"]);
  });

  it("gives twenty concurrent creations the keys OPA-1 to OPA-20 and distinct positions", async () => {
    const { actor } = await setup();

    const created = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        createTask(actor, "OPA", { title: `T${String(index)}` }),
      ),
    );

    expect(created.map((task) => task.number).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
    const positions = await getDb().select({ position: tasks.position }).from(tasks);
    expect(new Set(positions.map((row) => row.position)).size).toBe(20);
  });

  it("answers 404 for an unknown project and project_archived for an archived one", async () => {
    const { actor, managerActor } = await setup();
    await archiveProject(managerActor, "OPA");

    expect((await failure(createTask(actor, "NOPE", { title: "X" }))).status).toBe(404);
    expect((await failure(createTask(actor, "OPA", { title: "X" }))).code).toBe("project_archived");
  });

  it("needs tasks:write", async () => {
    await setup();
    const viewer = testActor(await createTestAccount({ email: "v@example.com", role: "viewer" }));

    expect((await failure(createTask(viewer, "OPA", { title: "X" }))).status).toBe(403);
  });
});

describe("getTask", () => {
  it("finds a task by id and by key, with its description", async () => {
    const { actor } = await setup();
    const task = await createTask(actor, "OPA", { title: "T", description: "*md*" });

    expect(await getTask(actor, task.id)).toEqual(task);
    expect(await getTask(actor, "OPA-1")).toEqual(task);
    for (const ref of [UNKNOWN, "OPA-2", "WEB-1"]) {
      expect((await failure(getTask(actor, ref))).status, ref).toBe(404);
    }
  });
});

describe("listTasks", () => {
  it("returns board order across columns, follows a column reorder, filters by column, and omits descriptions", async () => {
    const { actor, managerActor, columns } = await setup();
    const [todo, progress, done] = columns;
    await createTask(actor, "OPA", { title: "A", columnId: done?.id ?? "" });
    await createTask(actor, "OPA", { title: "B", columnId: todo?.id ?? "" });
    await createTask(actor, "OPA", { title: "C", columnId: progress?.id ?? "" });
    await createTask(actor, "OPA", { title: "D", columnId: todo?.id ?? "", description: "long" });

    const titles = async () =>
      (await listTasks(actor, "OPA", { limit: 50 })).items.map((task) => task.title);

    expect(await titles()).toEqual(["B", "D", "C", "A"]);
    await moveColumn(managerActor, done?.id ?? "", { afterColumnId: null, version: 1 });
    expect(await titles()).toEqual(["A", "B", "D", "C"]);

    const filtered = await listTasks(actor, "OPA", { limit: 50, columnId: todo?.id ?? "" });
    expect(filtered.items.map((task) => task.title)).toEqual(["B", "D"]);
    expect(Object.keys(filtered.items[0] ?? {})).not.toContain("description");
  });

  it("pages join up, and refuses a column of another project", async () => {
    const { actor, managerActor, columns } = await setup();
    for (const [index, column] of [0, 1, 2, 0, 1].entries()) {
      await createTask(actor, "OPA", {
        title: `T${String(index)}`,
        columnId: columns[column]?.id ?? "",
      });
    }
    await createProject(managerActor, { key: "WEB", name: "Web" });
    const [webColumn] = (await listColumns(managerActor, "WEB")).items;

    const all = (await listTasks(actor, "OPA", { limit: 50 })).items.map((task) => task.id);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listTasks(actor, "OPA", { limit: 2, ...(cursor ? { cursor } : {}) });
      seen.push(...page.items.map((task) => task.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);

    expect(seen).toEqual(all);
    expect(seen).toHaveLength(5);
    expect(
      (await failure(listTasks(actor, "OPA", { limit: 50, columnId: webColumn?.id ?? "" }))).status,
    ).toBe(400);
  });
});

describe("updateTask", () => {
  it("records one field_changed event per changed field, with old and new values", async () => {
    const { actor, member } = await setup();
    const task = await createTask(actor, "OPA", { title: "Old", description: "a" });

    const updated = await updateTask(actor, "OPA-1", {
      title: "New",
      description: "a",
      type: "story",
      version: 1,
    });

    expect(updated).toMatchObject({ title: "New", type: "story", version: 2 });
    const changes = (await eventsOf(task.id)).filter((event) => event.type === "field_changed");
    expect(
      changes.map((event) => [event.field, event.oldValue, event.newValue, event.actorAccountId]),
    ).toEqual([
      ["title", "Old", "New", member.id],
      ["type", "task", "story", member.id],
    ]);
  });

  it("answers version_conflict with the current task, and 404 for an unknown one", async () => {
    const { actor } = await setup();
    await createTask(actor, "OPA", { title: "T" });
    const current = await updateTask(actor, "OPA-1", { title: "First", version: 1 });

    const error = await failure(updateTask(actor, "OPA-1", { title: "Second", version: 1 }));

    expect(error.code).toBe("version_conflict");
    expect(error.current).toEqual(current);
    expect((await failure(updateTask(actor, "OPA-9", { title: "X", version: 1 }))).status).toBe(
      404,
    );
  });

  it("bumps version without events when nothing changes, and is refused in an archived project", async () => {
    const { actor, managerActor } = await setup();
    const task = await createTask(actor, "OPA", { title: "T" });

    expect((await updateTask(actor, "OPA-1", { title: "T", version: 1 })).version).toBe(2);
    expect(await eventsOf(task.id)).toHaveLength(1);

    await archiveProject(managerActor, "OPA");
    expect((await failure(updateTask(actor, "OPA-1", { title: "X", version: 2 }))).code).toBe(
      "project_archived",
    );
  });
});

describe("assignment", () => {
  it("assigns and clears a team and a person, recording each change", async () => {
    const { actor, managerActor } = await setup();
    const team = await createTeam(managerActor, { name: "Frontend" });
    const ada = await createTestAccount({ name: "Ada", email: "ada@example.com" });
    const task = await createTask(actor, "OPA", { title: "T", assigneeTeamId: team.id });

    const assigned = await updateTask(actor, "OPA-1", { assigneeAccountId: ada.id, version: 1 });
    expect(assigned).toMatchObject({
      assigneeTeam: { id: team.id, name: "Frontend" },
      assignee: { id: ada.id, name: "Ada", active: true },
    });

    const cleared = await updateTask(actor, "OPA-1", {
      assigneeTeamId: null,
      assigneeAccountId: null,
      version: 2,
    });
    expect(cleared).toMatchObject({ assigneeTeam: null, assignee: null });
    const changes = (await eventsOf(task.id)).filter((event) => event.type === "field_changed");
    expect(changes.map((event) => [event.field, event.oldValue, event.newValue])).toEqual([
      ["assigneeAccountId", null, ada.id],
      ["assigneeTeamId", team.id, null],
      ["assigneeAccountId", ada.id, null],
    ]);
  });

  it("refuses an unknown team and a non-person with 400, and a deactivated person with account_inactive", async () => {
    const { actor } = await setup();
    const gone = await createTestAccount({ email: "gone@example.com", disabled: true });
    const [invited] = await getDb()
      .insert(accounts)
      .values({ kind: "human", name: "Ivy", email: "ivy@example.com", role: "member" })
      .returning();
    await createTask(actor, "OPA", { title: "T" });

    const team = await failure(updateTask(actor, "OPA-1", { assigneeTeamId: UNKNOWN, version: 1 }));
    const person = await failure(
      updateTask(actor, "OPA-1", { assigneeAccountId: invited?.id ?? "", version: 1 }),
    );
    const inactive = await failure(
      createTask(actor, "OPA", { title: "X", assigneeAccountId: gone.id }),
    );

    expect(team.errors?.map((field) => field.path)).toEqual(["assigneeTeamId"]);
    expect(person.errors?.map((field) => field.path)).toEqual(["assigneeAccountId"]);
    expect(inactive.code).toBe("account_inactive");
  });

  it("keeps a person deactivated after assignment, shown inactive, through an edit of the title", async () => {
    const { actor } = await setup();
    const ada = await createTestAccount({ name: "Ada", email: "ada@example.com" });
    await createTask(actor, "OPA", { title: "T", assigneeAccountId: ada.id });
    await getDb().update(accounts).set({ disabledAt: new Date() }).where(eq(accounts.id, ada.id));

    const edited = await updateTask(actor, "OPA-1", { title: "Still Ada's", version: 1 });

    expect(edited.assignee).toEqual({ id: ada.id, name: "Ada", active: false });
  });
});

describe("history and change are one", () => {
  it("rolls back the task change when its event cannot be written", async () => {
    const { actor } = await setup();
    await createTask(actor, "OPA", { title: "T" });
    await getDb().execute(sql`
      create function fail_test_task_event() returns trigger as $$
      begin raise exception 'event write failed'; end; $$ language plpgsql`);
    await getDb().execute(sql`
      create trigger fail_test_task_event before insert on task_events
      for each row when (new.type = 'field_changed') execute function fail_test_task_event()`);
    try {
      await expect(updateTask(actor, "OPA-1", { title: "Lost", version: 1 })).rejects.toThrow();
    } finally {
      await getDb().execute(sql`drop trigger fail_test_task_event on task_events`);
      await getDb().execute(sql`drop function fail_test_task_event()`);
    }

    expect(await getTask(actor, "OPA-1")).toMatchObject({ title: "T", version: 1 });
  });
});

describe("team_in_use and column_not_empty", () => {
  it("keep a referenced team and column from being deleted", async () => {
    const { actor, managerActor, columns } = await setup();
    const used = await createTeam(managerActor, { name: "Used" });
    const free = await createTeam(managerActor, { name: "Free" });
    const ada = await createTestAccount({ name: "Ada", email: "ada@example.com" });
    await addTeamMember(managerActor, used.id, { accountId: ada.id });
    await createTask(actor, "OPA", {
      title: "T",
      assigneeTeamId: used.id,
      columnId: columns[0]?.id ?? "",
    });
    const empty = await createColumn(managerActor, "OPA", { name: "Empty", category: "todo" });

    expect((await failure(deleteTeam(managerActor, used.id))).code).toBe("team_in_use");
    expect((await failure(deleteColumn(managerActor, columns[0]?.id ?? ""))).code).toBe(
      "column_not_empty",
    );
    await deleteTeam(managerActor, free.id);
    await deleteColumn(managerActor, empty.id);
  });
});
