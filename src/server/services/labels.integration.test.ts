// Labels: the tables, the service, deleting a label in use (WS-107 tests 4 to 6, 11, 12).
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { agentActor } from "@/server/auth/actor";
import { createTestAccount, createTestAgent, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { auditLog, taskEvents } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

import { listenForEvents } from "./events-testing";
import { createLabel, deleteLabel, listLabels, updateLabel } from "./labels";
import { archiveProject, createProject } from "./projects";
import { createTask, deleteTask, getTask, listTasks } from "./tasks";

async function setup() {
  const admin = testActor(await createTestAccount({ email: "admin@example.com", role: "admin" }));
  const manager = testActor(
    await createTestAccount({ email: "manager@example.com", role: "manager" }),
  );
  const member = testActor(
    await createTestAccount({ name: "Mia", email: "mia@example.com", role: "member" }),
  );
  const viewer = testActor(await createTestAccount({ email: "vic@example.com", role: "viewer" }));
  const project = await createProject(manager, { key: "OPA", name: "Opanel" });
  return { admin, manager, member, viewer, project };
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

async function audits(action: string) {
  return getDb().select().from(auditLog).where(eq(auditLog.action, action)).orderBy(auditLog.id);
}

async function labelHistory(taskId: string) {
  return getDb()
    .select()
    .from(taskEvents)
    .where(and(eq(taskEvents.taskId, taskId), eq(taskEvents.field, "labels")))
    .orderBy(taskEvents.id);
}

async function agent(scopes: string[], projectIds: string[] | null = null) {
  const account = await createTestAgent({
    role: "worker_agent",
    scopes: scopes as never,
    projectIds,
  });
  return agentActor({ accountId: account.id, role: "worker_agent", scopes, projectIds });
}

describe("the labels tables (WS-107 test 4)", () => {
  it("refuses a colour outside the palette", async () => {
    const { project } = await setup();

    await expect(
      getDb().execute(sql`
        insert into labels (project_id, name, colour) values (${project.id}, 'Bug', 'black')`),
    ).rejects.toMatchObject({ cause: { constraint_name: "labels_colour_check" } });
  });

  it("keeps names unique per project, ignoring case", async () => {
    const { manager, project } = await setup();
    const other = await createProject(manager, { key: "OTH", name: "Other" });
    await getDb().execute(sql`
      insert into labels (project_id, name, colour) values (${project.id}, 'Bug', 'red')`);

    await expect(
      getDb().execute(sql`
        insert into labels (project_id, name, colour) values (${project.id}, 'BUG', 'red')`),
    ).rejects.toMatchObject({ cause: { constraint_name: "labels_project_name_lower_idx" } });
    await getDb().execute(sql`
      insert into labels (project_id, name, colour) values (${other.id}, 'bug', 'red')`);
  });

  it("drops a task's labels with the task", async () => {
    const { member, project } = await setup();
    const label = await createLabel(member, "OPA", { name: "Bug", colour: "red" });
    // Tasks are never deleted for real once they have history; one written by SQL has none.
    const [task] = await getDb().execute<{ id: string }>(sql`
      insert into tasks (project_id, number, title, column_id, position, reporter_account_id)
      select ${project.id}, 1, 'Old', id, 'a0', ${member.accountId}
      from columns where project_id = ${project.id} order by position limit 1
      returning id`);
    await getDb().execute(
      sql`insert into task_labels (task_id, label_id) values (${task?.id}, ${label.id})`,
    );

    await getDb().execute(sql`delete from tasks where id = ${task?.id}`);

    const rows = await getDb().execute(sql`select * from task_labels where label_id = ${label.id}`);
    expect(rows).toHaveLength(0);
  });
});

describe("the labels service (WS-107 test 5)", () => {
  it("lets a Member create, lists by name, and lets a Manager rename and recolour", async () => {
    const { member, manager, project } = await setup();
    const listener = await listenForEvents();
    try {
      const bug = await createLabel(member, "OPA", { name: "bug", colour: "red" });
      const design = await createLabel(member, project.id, { name: "Design", colour: "gray" });
      const api = await createLabel(member, "OPA", { name: "API", colour: "blue" });

      expect(bug).toMatchObject({ projectId: project.id, name: "bug", colour: "red", version: 1 });
      const listed = await listLabels(member, "OPA");
      expect(listed.nextCursor).toBeNull();
      expect(listed.items.map((label) => label.name)).toEqual(["API", "bug", "Design"]);

      const renamed = await updateLabel(manager, bug.id, { name: "Bug", version: 1 });
      expect(renamed).toMatchObject({ name: "Bug", colour: "red", version: 2 });
      const recoloured = await updateLabel(manager, bug.id, { colour: "orange", version: 2 });
      expect(recoloured).toMatchObject({ name: "Bug", colour: "orange", version: 3 });

      expect((await audits("label.created")).map((row) => row.entityId)).toEqual([
        bug.id,
        design.id,
        api.id,
      ]);
      expect((await audits("label.created"))[0]?.data).toEqual({
        projectId: project.id,
        name: "bug",
        colour: "red",
      });
      expect((await audits("label.updated")).map((row) => row.data)).toEqual([
        { projectId: project.id, changed: ["name"] },
        { projectId: project.id, changed: ["colour"] },
      ]);

      await deleteLabel(manager, api.id);
      expect((await listLabels(member, "OPA")).items.map((label) => label.name)).toEqual([
        "Bug",
        "Design",
      ]);
      expect((await audits("label.deleted"))[0]?.data).toEqual({
        projectId: project.id,
        name: "API",
        tasks: 0,
      });

      await listener.settle();
      expect(
        listener
          .events()
          .filter((event) => event.type === "label.changed")
          .map((event) => [event.entityId, event.version]),
      ).toEqual([
        [bug.id, 1],
        [design.id, 1],
        [api.id, 1],
        [bug.id, 2],
        [bug.id, 3],
        [api.id, null],
      ]);
    } finally {
      await listener.close();
    }
  });
});

describe("refusals (WS-107 test 6)", () => {
  it("lets only Managers change and delete, and nobody without labels:write create", async () => {
    const { member, viewer, manager } = await setup();
    const label = await createLabel(member, "OPA", { name: "Bug", colour: "red" });
    const worker = await agent(["projects:read", "tasks:read", "tasks:write"]);

    for (const attempt of [
      () => updateLabel(member, label.id, { name: "B", version: 1 }),
      () => deleteLabel(member, label.id),
      () => createLabel(viewer, "OPA", { name: "V", colour: "gray" }),
      () => updateLabel(viewer, label.id, { name: "V", version: 1 }),
      () => deleteLabel(viewer, label.id),
      () => createLabel(worker, "OPA", { name: "W", colour: "gray" }),
      () => updateLabel(worker, label.id, { name: "W", version: 1 }),
      () => deleteLabel(worker, label.id),
    ]) {
      expect((await failure(attempt())).status).toBe(403);
    }
    expect((await listLabels(viewer, "OPA")).items).toHaveLength(1);
    expect((await listLabels(worker, "OPA")).items).toHaveLength(1);
    expect(await labelCount()).toBe(1);
    await updateLabel(manager, label.id, { name: "Bugs", version: 1 });
  });

  it("refuses a duplicate name, ignoring case, on create and rename; its own case may change", async () => {
    const { member, manager } = await setup();
    const bug = await createLabel(member, "OPA", { name: "Bug", colour: "red" });
    const ui = await createLabel(member, "OPA", { name: "UI", colour: "blue" });

    const created = await failure(createLabel(member, "OPA", { name: "bug", colour: "gray" }));
    const renamed = await failure(updateLabel(manager, ui.id, { name: "BUG", version: 1 }));

    expect([created.status, created.code]).toEqual([409, "label_name_taken"]);
    expect([renamed.status, renamed.code]).toEqual([409, "label_name_taken"]);
    expect(await updateLabel(manager, bug.id, { name: "BUG", version: 1 })).toMatchObject({
      name: "BUG",
    });
  });

  it("refuses the 201st label of a project", async () => {
    const { member, project } = await setup();
    await getDb().execute(sql`
      insert into labels (project_id, name, colour)
      select ${project.id}, 'Label ' || n, 'gray' from generate_series(1, 200) n`);

    const refused = await failure(createLabel(member, "OPA", { name: "One more", colour: "red" }));

    expect([refused.status, refused.code]).toEqual([409, "too_many_labels"]);
  });

  it("answers a stale version with the current label", async () => {
    const { member, manager } = await setup();
    const label = await createLabel(member, "OPA", { name: "Bug", colour: "red" });
    await updateLabel(manager, label.id, { colour: "pink", version: 1 });

    const stale = await failure(updateLabel(manager, label.id, { name: "B", version: 1 }));

    expect([stale.status, stale.code]).toEqual([409, "version_conflict"]);
    expect(stale.current).toMatchObject({ id: label.id, colour: "pink", version: 2 });
  });

  it("refuses every write on an archived project", async () => {
    const { member, manager } = await setup();
    const label = await createLabel(member, "OPA", { name: "Bug", colour: "red" });
    await archiveProject(manager, "OPA");

    for (const attempt of [
      () => createLabel(member, "OPA", { name: "New", colour: "gray" }),
      () => updateLabel(manager, label.id, { name: "B", version: 1 }),
      () => deleteLabel(manager, label.id),
    ]) {
      const refused = await failure(attempt());
      expect([refused.status, refused.code]).toEqual([409, "project_archived"]);
    }
  });

  it("refuses a restricted agent another project's labels, and answers 404 for an unknown label", async () => {
    const { manager, member } = await setup();
    const other = await createProject(manager, { key: "OTH", name: "Other" });
    const restricted = await agent(["projects:read", "tasks:read"], [other.id]);
    const unknown = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";

    expect((await failure(listLabels(restricted, "OPA"))).status).toBe(403);
    expect((await listLabels(restricted, "OTH")).items).toEqual([]);
    expect((await failure(updateLabel(manager, unknown, { name: "B", version: 1 }))).status).toBe(
      404,
    );
    expect((await failure(deleteLabel(manager, unknown))).status).toBe(404);
    expect((await failure(listLabels(member, "NOPE"))).status).toBe(404);
  });
});

async function labelCount(): Promise<number> {
  const [row] = await getDb().execute<{ count: number }>(
    sql`select count(*)::int as count from labels`,
  );
  return row?.count ?? 0;
}

describe("deleting a label in use (WS-107 test 11)", () => {
  it("removes it from every task, deleted ones too, with history, versions and events", async () => {
    const { member, manager } = await setup();
    const bug = await createLabel(member, "OPA", { name: "Bug", colour: "red" });
    const ui = await createLabel(member, "OPA", { name: "UI", colour: "blue" });
    const one = await createTask(member, "OPA", { title: "One", labelIds: [bug.id, ui.id] });
    const two = await createTask(member, "OPA", { title: "Two", labelIds: [bug.id] });
    const gone = await createTask(member, "OPA", { title: "Gone", labelIds: [bug.id] });
    const untouched = await createTask(member, "OPA", { title: "Other", labelIds: [ui.id] });
    await deleteTask(manager, gone.id);
    const goneVersion = gone.version + 1;

    const listener = await listenForEvents();
    try {
      await deleteLabel(manager, bug.id);
      await listener.settle();

      expect(await getTask(member, one.id)).toMatchObject({
        labels: [{ id: ui.id, name: "UI", colour: "blue" }],
        version: one.version + 1,
      });
      expect(await getTask(member, two.id)).toMatchObject({ labels: [], version: two.version + 1 });
      expect(await getTask(member, untouched.id)).toMatchObject({ version: untouched.version });
      const [deleted] = (await listTasks(manager, "OPA", { limit: 100, deleted: "true" })).items;
      expect(deleted).toMatchObject({ id: gone.id, labels: [], version: goneVersion + 1 });

      for (const [task, before] of [
        [
          one,
          [
            { id: bug.id, name: "Bug" },
            { id: ui.id, name: "UI" },
          ],
        ],
        [two, [{ id: bug.id, name: "Bug" }]],
        [gone, [{ id: bug.id, name: "Bug" }]],
      ] as const) {
        const [entry] = (await labelHistory(task.id)).slice(-1);
        expect(entry).toMatchObject({
          type: "field_changed",
          actorAccountId: manager.accountId,
          oldValue: before,
          newValue: before.filter((label) => label.id !== bug.id),
        });
      }
      expect((await audits("label.deleted"))[0]?.data).toMatchObject({ name: "Bug", tasks: 3 });
      expect(
        listener
          .events()
          .map((event) => [event.type, event.entityId])
          .sort(),
      ).toEqual(
        [
          ["label.changed", bug.id],
          ["task.updated", one.id],
          ["task.updated", two.id],
        ].sort(),
      );
    } finally {
      await listener.close();
    }
  });
});

describe("deleting a popular label (WS-107 test 12)", () => {
  it("takes it off 1 000 tasks in one transaction", async () => {
    const { member, manager, project } = await setup();
    const label = await createLabel(member, "OPA", { name: "Bug", colour: "red" });
    const [column] = await getDb().execute<{ id: string }>(
      sql`select id from columns where project_id = ${project.id} order by position limit 1`,
    );
    await getDb().execute(sql`
      with made as (
        insert into tasks (project_id, number, title, column_id, position, reporter_account_id)
        select ${project.id}, n, 'Task ' || n, ${column?.id}, 'a' || lpad(n::text, 4, '0'),
          ${member.accountId}
        from generate_series(1, 1000) n
        returning id)
      insert into task_labels (task_id, label_id) select id, ${label.id} from made`);
    await getDb().execute(
      sql`update projects set next_task_number = 1001 where id = ${project.id}`,
    );

    const startedList = performance.now();
    const page = await listTasks(member, "OPA", { limit: 100 });
    const listMs = performance.now() - startedList;
    const started = performance.now();
    await deleteLabel(manager, label.id);
    const deleteMs = performance.now() - started;
    // Recorded in WS-107's implementation record (risk: the label subquery per task).
    console.warn(
      `WS-107 test 12: first board page of 100 labelled tasks ${listMs.toFixed(0)} ms; ` +
        `deleting the label on 1 000 tasks ${deleteMs.toFixed(0)} ms`,
    );

    expect(page.items.every((task) => task.labels.length === 1)).toBe(true);
    const [left] = await getDb().execute<{ count: number }>(
      sql`select count(*)::int as count from task_labels`,
    );
    expect(left?.count).toBe(0);
    const [entries] = await getDb().execute<{ count: number }>(
      sql`select count(*)::int as count from task_events where field = 'labels'`,
    );
    expect(entries?.count).toBe(1000);
    expect((await audits("label.deleted"))[0]?.data).toMatchObject({ tasks: 1000 });
  }, 60_000);
});
