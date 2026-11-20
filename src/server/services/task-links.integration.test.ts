import { describe, expect, it } from "vitest";

import { submitBugReportRequestSchema } from "@/lib/schemas/bug-reports";
import { agentActor } from "@/server/auth/actor";
import { createTestAccount, createTestAgent, testActor } from "@/server/auth/testing";
import { ApiError } from "@/server/http/errors";

import { fileBugReport } from "./bug-reports";
import { listColumns } from "./columns";
import { createProject } from "./projects";
import { createTask, deleteTask, getTask, moveTask, restoreTask, updateTask } from "./tasks";

// The links of a task in its answer (WS-090 section 5).

async function setup() {
  const manager = testActor(
    await createTestAccount({ name: "Manager", email: "manager@example.com", role: "manager" }),
  );
  await createProject(manager, { key: "OPA", name: "Opanel" });
  const columns = (await listColumns(manager, "OPA")).items;
  const agent = await createTestAgent({ scopes: ["reports:write"] });
  const bot = agentActor({
    accountId: agent.id,
    role: "qa_agent",
    scopes: ["reports:write"],
    projectIds: null,
  });
  return { manager, done: columns[2]?.id ?? "", todo: columns[0]?.id ?? "", bot };
}

const report = submitBugReportRequestSchema.parse({
  title: "Checkout returns 500",
  fingerprint: "api:/orders:500",
});

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected a failure");
}

/** OPA-1 closed, and OPA-2 filed as its regression. */
async function regression() {
  const fixture = await setup();
  const closed = await fileBugReport(fixture.bot, "OPA", report);
  await moveTask(fixture.manager, closed.taskKey, { columnId: fixture.done, version: 1 });
  const regressed = await fileBugReport(fixture.bot, "OPA", report);
  return { ...fixture, closed, regressed };
}

describe("links on a task (WS-090)", () => {
  it("names the closed bug on the regression, and the regression on the closed bug", async () => {
    const { manager, closed, regressed } = await regression();

    expect((await getTask(manager, regressed.taskKey)).links).toEqual([
      {
        type: "regression_of",
        direction: "outgoing",
        task: { id: closed.taskId, key: "OPA-1", title: "Checkout returns 500" },
      },
    ]);
    expect((await getTask(manager, closed.taskKey)).links).toEqual([
      {
        type: "regression_of",
        direction: "incoming",
        task: { id: regressed.taskId, key: "OPA-2", title: "Checkout returns 500" },
      },
    ]);
  });

  it("is in every answer that is a Task, and [] when there is none", async () => {
    const { manager, todo, regressed } = await regression();
    const plain = await createTask(manager, "OPA", { title: "Plain" });
    expect(plain.links).toEqual([]);
    expect((await getTask(manager, plain.key)).links).toEqual([]);

    const outgoing = [expect.objectContaining({ direction: "outgoing" })];
    const updated = await updateTask(manager, regressed.taskKey, { title: "Again", version: 1 });
    expect(updated.links).toEqual(outgoing);
    const moved = await moveTask(manager, regressed.taskKey, { columnId: todo, version: 2 });
    expect(moved.links).toEqual(outgoing);
    const conflict = await failure(
      updateTask(manager, regressed.taskKey, { title: "Stale", version: 1 }),
    );
    expect((conflict.current as { links: unknown }).links).toEqual(outgoing);
    const moveConflict = await failure(
      moveTask(manager, regressed.taskKey, { columnId: todo, version: 1 }),
    );
    expect((moveConflict.current as { links: unknown }).links).toEqual(outgoing);
    await deleteTask(manager, regressed.taskKey);
    expect((await restoreTask(manager, regressed.taskKey)).links).toEqual(outgoing);
  });

  it("leaves out a linked task that is deleted, and brings it back on restore", async () => {
    const { manager, closed, regressed } = await regression();

    await deleteTask(manager, closed.taskKey);
    expect((await getTask(manager, regressed.taskKey)).links).toEqual([]);

    await restoreTask(manager, closed.taskKey);
    expect((await getTask(manager, regressed.taskKey)).links).toHaveLength(1);
  });
});
