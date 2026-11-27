// Story points on tasks (WS-139 tests 1 to 5).
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { problemSchema } from "@/lib/schemas/problem";
import { taskSchema } from "@/lib/schemas/tasks";
import { agentActor } from "@/server/auth/actor";
import {
  apiRequest,
  createTestAccount,
  createTestAgent,
  signInCookie,
  testActor,
} from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { taskEvents, tasks } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

import { POST as create } from "@/app/api/v1/projects/[projectId]/tasks/route";
import { PATCH } from "@/app/api/v1/tasks/[taskId]/route";

import { listActivity } from "./activity";
import { createProject } from "./projects";
import { createTask, getTask, listBacklog, listTasks, updateTask } from "./tasks";

async function setup() {
  const manager = testActor(
    await createTestAccount({ email: "manager@example.com", role: "manager" }),
  );
  const member = await createTestAccount({ name: "Mia", email: "mia@example.com", role: "member" });
  const actor = testActor(member);
  const project = await createProject(manager, { key: "OPA", name: "Opanel" });
  return { manager, member, actor, project };
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

describe("the story_points column (WS-139 test 1)", () => {
  it("refuses -0.5, 1000 and 1.25, and accepts 0, 0.5 and 999.5", async () => {
    const { actor } = await setup();
    const task = await createTask(actor, "OPA", { title: "T" });

    for (const value of ["-0.5", "1000", "1.25"]) {
      await expect(
        getDb().execute(
          sql`update tasks set story_points = ${value}::numeric where id = ${task.id}`,
        ),
        value,
      ).rejects.toMatchObject({ cause: { constraint_name: "tasks_story_points_check" } });
    }
    for (const value of ["0", "0.5", "999.5"]) {
      await getDb().execute(
        sql`update tasks set story_points = ${value}::numeric where id = ${task.id}`,
      );
      expect((await getTask(actor, task.key)).storyPoints, value).toBe(Number(value));
    }
  });
});

describe("storyPoints on writes and answers (WS-139 test 2)", () => {
  it("is set on create, edited, cleared with null, and every answer carries it as a number", async () => {
    const { actor } = await setup();

    const created = await createTask(actor, "OPA", { title: "Set", storyPoints: 3 });
    const plain = await createTask(actor, "OPA", { title: "Plain", columnId: null });
    expect(created.storyPoints).toBe(3);
    expect(plain.storyPoints).toBeNull();

    const edited = await updateTask(actor, created.key, { storyPoints: 5.5, version: 1 });
    expect(edited.storyPoints).toBe(5.5);
    expect(taskSchema.parse(await getTask(actor, created.key)).storyPoints).toBe(5.5);
    expect((await listTasks(actor, "OPA", { limit: 50 })).items[0]?.storyPoints).toBe(5.5);
    expect((await listBacklog(actor, "OPA", { limit: 50 })).items[0]?.storyPoints).toBeNull();

    const cleared = await updateTask(actor, created.key, { storyPoints: null, version: 2 });
    expect(cleared.storyPoints).toBeNull();
    const [row] = await getDb().select().from(tasks).where(eq(tasks.id, created.id));
    expect(row?.storyPoints).toBeNull();
  });
});

describe("an invalid storyPoints (WS-139 test 3)", () => {
  it("is a 400 on storyPoints, on create and on edit, with nothing written", async () => {
    await setup();
    const cookie = await signInCookie("mia@example.com");
    const project = { params: Promise.resolve({ projectId: "OPA" }) };
    const task = { params: Promise.resolve({ taskId: "OPA-1" }) };
    await create(
      apiRequest("POST", "/api/v1/projects/OPA/tasks", {
        cookie,
        body: { title: "T", storyPoints: 2 },
      }),
      project,
    );

    for (const value of [-0.5, 1000, 1.25, "3", true]) {
      const refusedCreate = await create(
        apiRequest("POST", "/api/v1/projects/OPA/tasks", {
          cookie,
          body: { title: "Bad", storyPoints: value },
        }),
        project,
      );
      expect(refusedCreate.status, String(value)).toBe(400);
      expect(
        problemSchema.parse(await refusedCreate.json()).errors?.map((field) => field.path),
      ).toEqual(["storyPoints"]);

      const refusedEdit = await PATCH(
        apiRequest("PATCH", "/api/v1/tasks/OPA-1", {
          cookie,
          body: { storyPoints: value, version: 1 },
        }),
        task,
      );
      expect(refusedEdit.status, String(value)).toBe(400);
      expect(
        problemSchema.parse(await refusedEdit.json()).errors?.map((field) => field.path),
      ).toEqual(["storyPoints"]);
    }

    const rows = await getDb().select().from(tasks);
    expect(rows.map((row) => [row.title, row.storyPoints, row.version])).toEqual([["T", 2, 1]]);
  });
});

describe("a change to storyPoints in the history (WS-139 test 4)", () => {
  it("is one field_changed entry with both numbers, by the actor, which the activity answers", async () => {
    const { actor, member } = await setup();
    const task = await createTask(actor, "OPA", { title: "T" });

    await updateTask(actor, task.key, { storyPoints: 3, version: 1 });
    await updateTask(actor, task.key, { storyPoints: 5, version: 2 });
    await updateTask(actor, task.key, { storyPoints: 5, title: "Same points", version: 3 });
    await updateTask(actor, task.key, { storyPoints: null, version: 4 });

    const changes = (await history(task.id)).filter(
      (event) => event.type === "field_changed" && event.field === "storyPoints",
    );
    expect(changes.map((event) => [event.oldValue, event.newValue, event.actorAccountId])).toEqual([
      [null, 3, member.id],
      [3, 5, member.id],
      [5, null, member.id],
    ]);

    const activity = await listActivity(actor, task.key, { limit: 50 });
    const answered = activity.items.filter(
      (item) =>
        item.kind === "event" && item.type === "field_changed" && item.field === "storyPoints",
    );
    expect(
      answered.map((item) =>
        item.kind === "event" ? [item.oldValue, item.newValue, item.actor.name] : [],
      ),
    ).toEqual([
      [null, 3, "Mia"],
      [3, 5, "Mia"],
      [5, null, "Mia"],
    ]);
  });
});

describe("who may set storyPoints (WS-139 test 5)", () => {
  it("refuses a Viewer and a qa_agent with 403; a worker_agent sets them", async () => {
    const { actor } = await setup();
    const task = await createTask(actor, "OPA", { title: "T" });
    const viewer = testActor(
      await createTestAccount({ email: "viewer@example.com", role: "viewer" }),
    );
    const qaScopes = ["projects:read", "tasks:read", "reports:write"] as const;
    const qa = await createTestAgent({ name: "QA Bot", role: "qa_agent", scopes: [...qaScopes] });
    const qaActor = agentActor({
      accountId: qa.id,
      role: "qa_agent",
      scopes: qaScopes,
      projectIds: null,
    });
    const workerScopes = ["projects:read", "tasks:read", "tasks:write"] as const;
    const worker = await createTestAgent({
      name: "Worker",
      role: "worker_agent",
      scopes: [...workerScopes],
    });
    const workerActor = agentActor({
      accountId: worker.id,
      role: "worker_agent",
      scopes: workerScopes,
      projectIds: null,
    });

    expect((await getTask(viewer, task.key)).storyPoints).toBeNull();
    expect(
      (await failure(updateTask(viewer, task.key, { storyPoints: 3, version: 1 }))).status,
    ).toBe(403);
    expect(
      (await failure(updateTask(qaActor, task.key, { storyPoints: 3, version: 1 }))).status,
    ).toBe(403);
    expect((await failure(createTask(qaActor, "OPA", { title: "Q", storyPoints: 1 }))).status).toBe(
      403,
    );

    const set = await updateTask(workerActor, task.key, { storyPoints: 8, version: 1 });
    expect(set.storyPoints).toBe(8);
    const byWorker = await createTask(workerActor, "OPA", { title: "W", storyPoints: 0.5 });
    expect(byWorker.storyPoints).toBe(0.5);
  });
});
