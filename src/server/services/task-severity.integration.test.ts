import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

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
  listTasks,
  moveTask,
  restoreTask,
  updateTask,
} from "./tasks";

// Severity on tasks, and the bug fields in every answer (WS-088).

async function setup() {
  const manager = await createTestAccount({
    name: "Manager",
    email: "manager@example.com",
    role: "manager",
  });
  const member = await createTestAccount({ name: "Mia", email: "mia@example.com", role: "member" });
  const managerActor = testActor(manager);
  const actor = testActor(member);
  await createProject(managerActor, { key: "OPA", name: "Opanel" });
  const columns = (await listColumns(managerActor, "OPA")).items;
  return { member, managerActor, actor, columns };
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

describe("the bug fields of a task (WS-088)", () => {
  it("a task created as before has no severity, no fingerprint and no reports", async () => {
    const { actor } = await setup();

    const task = await createTask(actor, "OPA", { title: "Plain" });

    expect(task).toMatchObject({
      severity: null,
      fingerprint: null,
      occurrences: 0,
      lastReportedAt: null,
    });
    expect((await listTasks(actor, "OPA", { limit: 50 })).items[0]).toMatchObject({
      severity: null,
      fingerprint: null,
      occurrences: 0,
      lastReportedAt: null,
    });
  });

  it("a bug created with a severity answers it, and its created entry names it", async () => {
    const { actor, member, columns } = await setup();

    const bug = await createTask(actor, "OPA", { title: "Crash", type: "bug", severity: "high" });

    expect(bug.severity).toBe("high");
    expect(await eventsOf(bug.id)).toEqual([
      expect.objectContaining({
        actorAccountId: member.id,
        type: "created",
        newValue: {
          key: "OPA-1",
          type: "bug",
          title: "Crash",
          columnId: columns[0]?.id,
          severity: "high",
        },
      }),
    ]);
  });

  it("sets, changes and clears a bug's severity, each a field_changed entry", async () => {
    const { actor, member } = await setup();
    const bug = await createTask(actor, "OPA", { title: "Crash", type: "bug" });
    expect(bug.severity).toBeNull();

    const set = await updateTask(actor, "OPA-1", { severity: "low", version: 1 });
    const changed = await updateTask(actor, "OPA-1", { severity: "critical", version: 2 });
    const cleared = await updateTask(actor, "OPA-1", { severity: null, version: 3 });

    expect([set.severity, changed.severity, cleared.severity]).toEqual(["low", "critical", null]);
    expect(cleared.version).toBe(4);
    const changes = (await eventsOf(bug.id)).filter((event) => event.type === "field_changed");
    expect(
      changes.map((event) => [event.actorAccountId, event.field, event.oldValue, event.newValue]),
    ).toEqual([
      [member.id, "severity", null, "low"],
      [member.id, "severity", "low", "critical"],
      [member.id, "severity", "critical", null],
    ]);
  });

  it("refuses a severity on a task that is not, or will not be, a bug, and writes nothing", async () => {
    const { actor } = await setup();
    await createTask(actor, "OPA", { title: "Plain" });
    const bug = await createTask(actor, "OPA", { title: "Crash", type: "bug", severity: "low" });

    const onTask = await failure(updateTask(actor, "OPA-1", { severity: "high", version: 1 }));
    const onFormerBug = await failure(
      updateTask(actor, "OPA-2", { type: "task", severity: "low", version: 1 }),
    );

    for (const error of [onTask, onFormerBug]) {
      expect(error.status).toBe(400);
      expect(error.errors?.map((field) => field.path)).toEqual(["severity"]);
    }
    expect(await getTask(actor, "OPA-1")).toMatchObject({ severity: null, version: 1 });
    expect(await getTask(actor, "OPA-2")).toMatchObject({
      type: "bug",
      severity: "low",
      version: 1,
    });
    expect((await eventsOf(bug.id)).map((event) => event.type)).toEqual(["created"]);
  });

  it("a bug that becomes a story loses its severity; a task that becomes a bug gets none", async () => {
    const { actor, member } = await setup();
    const bug = await createTask(actor, "OPA", {
      title: "Crash",
      type: "bug",
      severity: "critical",
    });
    await createTask(actor, "OPA", { title: "Plain" });

    const story = await updateTask(actor, "OPA-1", { type: "story", version: 1 });
    const becameBug = await updateTask(actor, "OPA-2", { type: "bug", version: 1 });

    expect(story).toMatchObject({ type: "story", severity: null });
    expect(becameBug).toMatchObject({ type: "bug", severity: null });
    const changes = (await eventsOf(bug.id)).filter((event) => event.type === "field_changed");
    expect(
      changes.map((event) => [event.actorAccountId, event.field, event.oldValue, event.newValue]),
    ).toEqual([
      [member.id, "type", "bug", "story"],
      [member.id, "severity", "critical", null],
    ]);
  });

  it("returns what the pipeline writes from every operation that answers a task", async () => {
    const { actor, managerActor, columns } = await setup();
    const bug = await createTask(actor, "OPA", { title: "Crash", type: "bug", severity: "high" });
    await getDb()
      .update(tasks)
      .set({
        fingerprint: "fp-login-500",
        occurrences: 3,
        lastReportedAt: sql`'2026-11-20T08:30:00.123Z'::timestamptz`,
      })
      .where(eq(tasks.id, bug.id));
    const fields = {
      severity: "high",
      fingerprint: "fp-login-500",
      occurrences: 3,
      lastReportedAt: "2026-11-20T08:30:00.123Z",
    };

    expect(await getTask(actor, "OPA-1")).toMatchObject(fields);
    expect((await listTasks(actor, "OPA", { limit: 50 })).items[0]).toMatchObject(fields);
    const moved = await moveTask(actor, "OPA-1", { columnId: columns[1]?.id ?? "", version: 1 });
    expect(moved).toMatchObject(fields);
    const conflict = await failure(updateTask(actor, "OPA-1", { title: "X", version: 1 }));
    expect(conflict.current).toMatchObject(fields);
    await deleteTask(managerActor, "OPA-1");
    expect(
      (await listTasks(managerActor, "OPA", { limit: 50, deleted: "true" })).items[0],
    ).toMatchObject(fields);
    expect(await restoreTask(managerActor, "OPA-1")).toMatchObject(fields);
  });
});
