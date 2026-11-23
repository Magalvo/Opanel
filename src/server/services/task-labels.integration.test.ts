// Labels on tasks: labelIds on create and update, the history, the answers (WS-107 tests 7
// to 10).
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { agentActor } from "@/server/auth/actor";
import { createTestAccount, createTestAgent, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { taskEvents } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

import { listColumns } from "./columns";
import { createLabel, updateLabel } from "./labels";
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
  const member = testActor(
    await createTestAccount({ name: "Mia", email: "mia@example.com", role: "member" }),
  );
  await createProject(manager, { key: "OPA", name: "Opanel" });
  const [todo, progress] = (await listColumns(manager, "OPA")).items.map((column) => column.id);
  if (!todo || !progress) throw new Error("no columns");
  const ui = await createLabel(member, "OPA", { name: "ui", colour: "blue" });
  const bug = await createLabel(member, "OPA", { name: "Bug", colour: "red" });
  const api = await createLabel(member, "OPA", { name: "API", colour: "green" });
  return { manager, member, todo, progress, ui, bug, api };
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

async function entries(taskId: string, type: string) {
  return getDb()
    .select()
    .from(taskEvents)
    .where(and(eq(taskEvents.taskId, taskId), eq(taskEvents.type, type)))
    .orderBy(taskEvents.id);
}

const ref = (label: { id: string; name: string; colour: string }) => ({
  id: label.id,
  name: label.name,
  colour: label.colour,
});
const named = (label: { id: string; name: string }) => ({ id: label.id, name: label.name });

describe("createTask with labelIds (WS-107 test 7)", () => {
  it("answers the labels by name and names them in the created entry; without, none", async () => {
    const { member, ui, bug, api } = await setup();

    const task = await createTask(member, "OPA", { title: "T", labelIds: [ui.id, bug.id, api.id] });
    const bare = await createTask(member, "OPA", { title: "Bare" });

    expect(task.labels).toEqual([ref(api), ref(bug), ref(ui)]);
    expect(bare.labels).toEqual([]);
    const [created] = await entries(task.id, "created");
    expect(created?.newValue).toMatchObject({ labels: [named(api), named(bug), named(ui)] });
    const [plain] = await entries(bare.id, "created");
    expect(plain?.newValue).not.toHaveProperty("labels");
  });
});

describe("updateTask with labelIds (WS-107 test 8)", () => {
  it("sets, replaces and clears, one entry each, one version per PATCH", async () => {
    const { member, ui, bug, api } = await setup();
    const task = await createTask(member, "OPA", { title: "T" });

    const set = await updateTask(member, task.id, { labelIds: [bug.id], version: 1 });
    const replaced = await updateTask(member, task.id, { labelIds: [api.id, ui.id], version: 2 });
    const cleared = await updateTask(member, task.id, { labelIds: [], version: 3 });

    expect(set).toMatchObject({ labels: [ref(bug)], version: 2 });
    expect(replaced).toMatchObject({ labels: [ref(api), ref(ui)], version: 3 });
    expect(cleared).toMatchObject({ labels: [], version: 4 });
    expect(
      (await entries(task.id, "field_changed")).map((entry) => [
        entry.field,
        entry.oldValue,
        entry.newValue,
        entry.actorAccountId,
      ]),
    ).toEqual([
      ["labels", [], [named(bug)], member.accountId],
      ["labels", [named(bug)], [named(api), named(ui)], member.accountId],
      ["labels", [named(api), named(ui)], [], member.accountId],
    ]);
  });

  it("records nothing for the same set in another order, but still makes one version", async () => {
    const { member, ui, api } = await setup();
    const task = await createTask(member, "OPA", { title: "T", labelIds: [api.id, ui.id] });

    const same = await updateTask(member, task.id, { labelIds: [ui.id, api.id], version: 1 });

    expect(same).toMatchObject({ labels: [ref(api), ref(ui)], version: 2 });
    expect(await entries(task.id, "field_changed")).toEqual([]);
  });

  it("changes labels and another field in one PATCH, with one entry for each", async () => {
    const { member, bug } = await setup();
    const task = await createTask(member, "OPA", { title: "T" });

    const updated = await updateTask(member, task.id, {
      title: "T2",
      labelIds: [bug.id],
      version: 1,
    });

    expect(updated).toMatchObject({ title: "T2", labels: [ref(bug)], version: 2 });
    expect((await entries(task.id, "field_changed")).map((entry) => entry.field)).toEqual([
      "title",
      "labels",
    ]);
  });
});

describe("labelIds refused (WS-107 test 9)", () => {
  it("refuses a label of another project or an unknown id, naming labelIds", async () => {
    const { manager, member, bug } = await setup();
    await createProject(manager, { key: "OTH", name: "Other" });
    const foreign = await createLabel(member, "OTH", { name: "Bug", colour: "red" });
    const task = await createTask(member, "OPA", { title: "T" });

    for (const attempt of [
      createTask(member, "OPA", { title: "T", labelIds: [bug.id, foreign.id] }),
      updateTask(member, task.id, { labelIds: [foreign.id], version: 1 }),
      updateTask(member, task.id, {
        labelIds: ["0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f"],
        version: 1,
      }),
    ]) {
      const refused = await failure(attempt);
      expect(refused.status).toBe(400);
      expect(refused.errors).toEqual([
        { path: "labelIds", message: "Not a label of this project." },
      ]);
    }
    expect(await getTask(member, task.id)).toMatchObject({ labels: [], version: 1 });
  });

  it("refuses labelIds from an agent with tasks:write, which may still write the rest", async () => {
    const { member, bug } = await setup();
    const scopes = ["projects:read", "tasks:read", "tasks:write"];
    const account = await createTestAgent({
      role: "worker_agent",
      scopes: scopes as never,
    });
    const worker = agentActor({
      accountId: account.id,
      role: "worker_agent",
      scopes,
      projectIds: null,
    });
    const task = await createTask(member, "OPA", { title: "T" });

    for (const attempt of [
      createTask(worker, "OPA", { title: "W", labelIds: [bug.id] }),
      createTask(worker, "OPA", { title: "W", labelIds: [] }),
      updateTask(worker, task.id, { labelIds: [bug.id], version: 1 }),
    ]) {
      expect((await failure(attempt)).status).toBe(403);
    }
    expect(await createTask(worker, "OPA", { title: "W" })).toMatchObject({ labels: [] });
    expect(await updateTask(worker, task.id, { title: "T2", version: 1 })).toMatchObject({
      version: 2,
    });
  });
});

describe("labels in every answer (WS-107 test 10)", () => {
  it("come back from get, both lists, move, restore and a 409's current", async () => {
    const { manager, member, progress, bug, ui } = await setup();
    const task = await createTask(member, "OPA", { title: "T", labelIds: [ui.id, bug.id] });
    const queued = await createTask(member, "OPA", {
      title: "Q",
      columnId: null,
      labelIds: [bug.id],
    });
    const expected = [ref(bug), ref(ui)];

    expect((await getTask(member, "OPA-1")).labels).toEqual(expected);
    expect(
      (await listTasks(member, "OPA", { limit: 100 })).items.find((each) => each.id === task.id)
        ?.labels,
    ).toEqual(expected);
    expect((await listBacklog(member, "OPA", { limit: 100 })).items[0]).toMatchObject({
      id: queued.id,
      labels: [ref(bug)],
    });
    const moved = await moveTask(member, task.id, { columnId: progress, version: 1 });
    expect(moved.labels).toEqual(expected);
    const stale = await failure(updateTask(member, task.id, { title: "X", version: 1 }));
    expect(stale.current).toMatchObject({ labels: expected });
    await deleteTask(manager, task.id);
    expect((await restoreTask(manager, task.id)).labels).toEqual(expected);
  });

  it("show a rename and a recolour with no change to the task's version", async () => {
    const { manager, member, bug } = await setup();
    const task = await createTask(member, "OPA", { title: "T", labelIds: [bug.id] });

    await updateLabel(manager, bug.id, { name: "Defect", colour: "pink", version: 1 });

    expect(await getTask(member, task.id)).toMatchObject({
      labels: [{ id: bug.id, name: "Defect", colour: "pink" }],
      version: task.version,
    });
    expect(await entries(task.id, "field_changed")).toEqual([]);
  });
});
