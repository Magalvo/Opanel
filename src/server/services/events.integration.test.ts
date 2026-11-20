import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ProjectEvent } from "@/lib/schemas/events";
import { createTestAccount, failAuditFor, testActor } from "@/server/auth/testing";
import { type Database, getDb } from "@/server/db/client";
import { tasks } from "@/server/db/schema";

import { createColumn, deleteColumn, listColumns, moveColumn, updateColumn } from "./columns";
import { createComment } from "./comments";
import { createEpic, updateEpic } from "./epics";
import { type ProjectEventInput, publishEvent } from "./events";
import { type EventListener, listenForEvents } from "./events-testing";
import { archiveProject, createProject, unarchiveProject, updateProject } from "./projects";
import { createTask, deleteTask, moveTask, restoreTask, updateTask } from "./tasks";
import { updateTriage } from "./triage";

let listener: EventListener;

beforeEach(async () => {
  listener = await listenForEvents();
});

afterEach(async () => {
  await listener.close();
});

async function setup() {
  const manager = await createTestAccount({
    name: "Manager",
    email: "manager@example.com",
    role: "manager",
  });
  const member = await createTestAccount({ name: "Mia", email: "mia@example.com", role: "member" });
  const viewer = await createTestAccount({ name: "Vic", email: "vic@example.com", role: "viewer" });
  const managerActor = testActor(manager);
  const actor = testActor(member);
  const viewerActor = testActor(viewer);
  const project = await createProject(managerActor, { key: "OPA", name: "Opanel" });
  const columns = (await listColumns(managerActor, "OPA")).items;
  return { manager, managerActor, member, actor, viewerActor, project, columns };
}

/** The events committed since the last call, once they have all arrived. */
async function received(): Promise<ProjectEvent[]> {
  await listener.settle();
  return listener.events();
}

/** Runs `write` and returns the events it sent, ignoring those of the setup before it. */
async function eventsOf(write: () => Promise<unknown>): Promise<ProjectEvent[]> {
  const before = (await received()).length;
  await write();
  return (await received()).slice(before);
}

/** Like `eventsOf`, for a write that must be refused or rolled back. */
async function eventsOfRefused(write: () => Promise<unknown>): Promise<ProjectEvent[]> {
  return eventsOf(() => expect(write()).rejects.toThrow());
}

async function taskVersion(id: string): Promise<number> {
  const [row] = await getDb()
    .select({ version: tasks.version })
    .from(tasks)
    .where(eq(tasks.id, id));
  return row?.version ?? 0;
}

describe("publishEvent (WS-045)", () => {
  function input(projectId: string, actorAccountId: string): ProjectEventInput {
    return {
      type: "task.updated",
      entity: "task",
      projectId,
      entityId: projectId,
      version: 2,
      actorAccountId,
    };
  }

  it("sends one event per call on commit, each with its own id and a current time", async () => {
    const { project, member } = await setup();
    const start = Date.now();

    const sent = await eventsOf(() =>
      getDb().transaction(async (tx) => {
        await publishEvent(tx, input(project.id, member.id));
        await publishEvent(tx, input(project.id, member.id));
      }),
    );

    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ ...input(project.id, member.id) });
    expect(sent[0]?.id).not.toBe(sent[1]?.id);
    for (const event of sent) {
      expect(Date.parse(event.at)).toBeGreaterThanOrEqual(start - 1_000);
      expect(Date.parse(event.at)).toBeLessThanOrEqual(Date.now() + 1_000);
    }
  });

  it("sends nothing when the transaction rolls back", async () => {
    const { project, member } = await setup();

    const sent = await eventsOfRefused(() =>
      getDb().transaction(async (tx) => {
        await publishEvent(tx, input(project.id, member.id));
        throw new Error("rolled back");
      }),
    );

    expect(sent).toEqual([]);
  });

  it("refuses an event that does not match the contract, and the write with it", async () => {
    const { project, member } = await setup();
    const malformed = { ...input(project.id, member.id), version: null } as unknown;

    await expect(
      getDb().transaction(async (tx) => {
        await publishEvent(tx, malformed as ProjectEventInput);
      }),
    ).rejects.toThrow();
    expect(await received()).toEqual([]);
  });
});

describe("each write sends its event (WT-04 decision 2)", () => {
  it("tasks: created, updated, moved, deleted and restored, with the version after the write", async () => {
    const { actor, managerActor, member, manager, project, columns } = await setup();
    const common = { entity: "task", projectId: project.id };

    let task = await createTask(actor, "OPA", { title: "First" });
    expect(await received()).toEqual([
      expect.objectContaining({
        ...common,
        type: "task.created",
        entityId: task.id,
        version: task.version,
        actorAccountId: member.id,
      }),
    ]);

    let sent = await eventsOf(async () => {
      task = await updateTask(actor, task.key, { title: "Renamed", version: task.version });
    });
    expect(sent).toEqual([
      expect.objectContaining({ ...common, type: "task.updated", version: task.version }),
    ]);

    sent = await eventsOf(async () => {
      task = await moveTask(actor, task.key, {
        columnId: columns[1]?.id ?? "",
        version: task.version,
      });
    });
    expect(sent).toEqual([
      expect.objectContaining({ ...common, type: "task.moved", version: task.version }),
    ]);

    sent = await eventsOf(() => deleteTask(actor, task.key));
    expect(sent).toEqual([
      expect.objectContaining({
        ...common,
        type: "task.deleted",
        entityId: task.id,
        version: await taskVersion(task.id),
      }),
    ]);

    sent = await eventsOf(async () => {
      task = await restoreTask(managerActor, task.key);
    });
    expect(sent).toEqual([
      expect.objectContaining({
        ...common,
        type: "task.restored",
        version: task.version,
        actorAccountId: manager.id,
      }),
    ]);
  });

  it("an update that changes no field and a move within one column send their event", async () => {
    const { actor, project } = await setup();
    let task = await createTask(actor, "OPA", { title: "Same" });

    let sent = await eventsOf(async () => {
      task = await updateTask(actor, task.key, { title: "Same", version: task.version });
    });
    expect(sent).toEqual([
      expect.objectContaining({ type: "task.updated", projectId: project.id, version: 2 }),
    ]);

    sent = await eventsOf(async () => {
      task = await moveTask(actor, task.key, { columnId: task.columnId, version: task.version });
    });
    expect(sent).toEqual([expect.objectContaining({ type: "task.moved", version: 3 })]);
  });

  it("comments: comment.created carries the task's id and no version", async () => {
    const { actor, member, project } = await setup();
    const task = await createTask(actor, "OPA", { title: "Discussed" });

    let comment: { id: string } | undefined;
    const sent = await eventsOf(async () => {
      comment = await createComment(actor, task.key, { body: "Looks good" });
    });

    expect(sent).toEqual([
      {
        id: expect.any(String) as string,
        at: expect.any(String) as string,
        type: "comment.created",
        entity: "comment",
        projectId: project.id,
        entityId: comment?.id,
        taskId: task.id,
        version: null,
        actorAccountId: member.id,
      },
    ]);
  });

  it("columns: created, renamed, moved and deleted each send column.changed", async () => {
    const { managerActor, manager, project } = await setup();
    const common = { type: "column.changed", entity: "column", projectId: project.id };

    let column = await createColumn(managerActor, "OPA", {
      name: "Review",
      category: "in_progress",
    });
    let sent = await eventsOf(async () => {
      column = await updateColumn(managerActor, column.id, {
        name: "Checking",
        version: column.version,
      });
    });
    expect(sent).toEqual([
      expect.objectContaining({
        ...common,
        entityId: column.id,
        version: column.version,
        actorAccountId: manager.id,
      }),
    ]);

    sent = await eventsOf(async () => {
      column = await moveColumn(managerActor, column.id, {
        afterColumnId: null,
        version: column.version,
      });
    });
    expect(sent).toEqual([expect.objectContaining({ ...common, version: column.version })]);

    sent = await eventsOf(() => deleteColumn(managerActor, column.id));
    expect(sent).toEqual([
      expect.objectContaining({ ...common, entityId: column.id, version: null }),
    ]);
  });

  it("creating a column sends column.changed", async () => {
    const { managerActor, project } = await setup();

    let column: { id: string; version: number } | undefined;
    const sent = await eventsOf(async () => {
      column = await createColumn(managerActor, "OPA", { name: "Review", category: "todo" });
    });

    expect(sent).toEqual([
      expect.objectContaining({
        type: "column.changed",
        projectId: project.id,
        entityId: column?.id,
        version: column?.version,
      }),
    ]);
  });

  it("deleting a column with deleted tasks in it sends one column.changed and no task event", async () => {
    const { actor, managerActor } = await setup();
    const column = await createColumn(managerActor, "OPA", { name: "Old", category: "todo" });
    const task = await createTask(actor, "OPA", { title: "Gone", columnId: column.id });
    await deleteTask(actor, task.key);

    const sent = await eventsOf(() => deleteColumn(managerActor, column.id));

    expect(sent.map((event) => event.type)).toEqual(["column.changed"]);
  });

  it("epics: created and closed each send epic.changed", async () => {
    const { managerActor, project } = await setup();

    let epic: { id: string; version: number } | undefined;
    let sent = await eventsOf(async () => {
      epic = await createEpic(managerActor, "OPA", { title: "Launch" });
    });
    expect(sent).toEqual([
      expect.objectContaining({
        type: "epic.changed",
        entity: "epic",
        projectId: project.id,
        entityId: epic?.id,
        version: epic?.version,
      }),
    ]);

    sent = await eventsOf(async () => {
      epic = await updateEpic(managerActor, epic?.id ?? "", {
        status: "closed",
        version: epic?.version ?? 0,
      });
    });
    expect(sent).toEqual([
      expect.objectContaining({ type: "epic.changed", version: epic?.version }),
    ]);
  });

  it("projects: a triage change sends project.changed with the new version (WS-087)", async () => {
    const { managerActor, project } = await setup();
    let version = 0;

    const sent = await eventsOf(async () => {
      version = (await updateTriage(managerActor, "OPA", { version: project.version })).version;
    });

    expect(sent).toEqual([
      expect.objectContaining({
        type: "project.changed",
        projectId: project.id,
        entityId: project.id,
        version,
      }),
    ]);
  });

  it("projects: renamed, archived and unarchived each send project.changed about itself", async () => {
    const { managerActor, project } = await setup();
    const common = {
      type: "project.changed",
      entity: "project",
      projectId: project.id,
      entityId: project.id,
    };

    let current = project;
    let sent = await eventsOf(async () => {
      current = await updateProject(managerActor, "OPA", {
        name: "Renamed",
        version: current.version,
      });
    });
    expect(sent).toEqual([expect.objectContaining({ ...common, version: current.version })]);

    sent = await eventsOf(async () => {
      current = await archiveProject(managerActor, "OPA");
    });
    expect(sent).toEqual([expect.objectContaining({ ...common, version: current.version })]);

    sent = await eventsOf(async () => {
      current = await unarchiveProject(managerActor, "OPA");
    });
    expect(sent).toEqual([expect.objectContaining({ ...common, version: current.version })]);
  });
});

describe("a call that writes nothing sends nothing", () => {
  it("creating a project", async () => {
    const manager = await createTestAccount({ email: "m@example.com", role: "manager" });

    const sent = await eventsOf(() =>
      createProject(testActor(manager), { key: "NEW", name: "New" }),
    );

    expect(sent).toEqual([]);
  });

  it("restoring a task that is not deleted, archiving twice, unarchiving an active project", async () => {
    const { actor, managerActor } = await setup();
    const task = await createTask(actor, "OPA", { title: "Alive" });

    expect(await eventsOf(() => restoreTask(managerActor, task.key))).toEqual([]);
    expect(await eventsOf(() => unarchiveProject(managerActor, "OPA"))).toEqual([]);
    await archiveProject(managerActor, "OPA");
    expect(await eventsOf(() => archiveProject(managerActor, "OPA"))).toEqual([]);
  });
});

describe("a refused or rolled-back write sends nothing", () => {
  it("a stale version, a Viewer's write, a write to an archived project", async () => {
    const { actor, viewerActor, managerActor } = await setup();
    const task = await createTask(actor, "OPA", { title: "Contested" });

    expect(
      await eventsOfRefused(() => updateTask(actor, task.key, { title: "X", version: 9 })),
    ).toEqual([]);
    expect(await eventsOfRefused(() => createTask(viewerActor, "OPA", { title: "No" }))).toEqual(
      [],
    );
    await archiveProject(managerActor, "OPA");
    expect(await eventsOfRefused(() => createTask(actor, "OPA", { title: "Late" }))).toEqual([]);
  });

  it("a write whose audit entry cannot be written", async () => {
    const { managerActor } = await setup();
    const restore = await failAuditFor("column.created");
    try {
      const sent = await eventsOfRefused(() =>
        createColumn(managerActor, "OPA", { name: "Never", category: "todo" }),
      );
      expect(sent).toEqual([]);
    } finally {
      await restore();
    }
  });

  it("a write whose history event cannot be written", async () => {
    const { actor } = await setup();
    const task = await createTask(actor, "OPA", { title: "T" });
    await getDb().execute(sql`
      create function fail_test_task_event() returns trigger as $$
      begin raise exception 'event write failed'; end; $$ language plpgsql`);
    await getDb().execute(sql`
      create trigger fail_test_task_event before insert on task_events
      for each row when (new.type = 'field_changed') execute function fail_test_task_event()`);
    try {
      const sent = await eventsOfRefused(() =>
        updateTask(actor, task.key, { title: "Lost", version: task.version }),
      );
      expect(sent).toEqual([]);
    } finally {
      await getDb().execute(sql`drop trigger fail_test_task_event on task_events`);
      await getDb().execute(sql`drop function fail_test_task_event()`);
    }
  });

  it("a service call inside an outer transaction that rolls back", async () => {
    const { actor } = await setup();

    const sent = await eventsOfRefused(() =>
      getDb().transaction(async (tx) => {
        // Services take the client, whose `transaction` a drizzle transaction also has (it
        // opens a savepoint); only the pool handle `$client` is missing, which they never use.
        await createTask(actor, "OPA", { title: "Undone" }, tx as unknown as Database);
        throw new Error("rolled back");
      }),
    );

    expect(sent).toEqual([]);
  });
});
