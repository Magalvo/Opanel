import { describe, expect, it } from "vitest";

import {
  submitBugReportRequestSchema,
  TASK_LINK_TYPES,
  type TaskLinkType,
} from "@/lib/schemas/bug-reports";
import type { AgentScope } from "@/lib/schemas/permissions";
import { MAX_TASK_LINKS } from "@/lib/schemas/task-links";
import { agentActor } from "@/server/auth/actor";
import { createTestAccount, createTestAgent, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { ApiError } from "@/server/http/errors";

import { fileBugReport } from "./bug-reports";
import { listColumns } from "./columns";
import { listenForEvents } from "./events-testing";
import { archiveProject, createProject } from "./projects";
import { addTaskLink, removeTaskLink } from "./task-links";
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

// Adding and removing links (WS-134 tests 3 to 12).

type Direction = "outgoing" | "incoming";

const linkRequest = (type: TaskLinkType, direction: Direction, taskId: string) => ({
  type,
  direction,
  taskId,
});

const READING = { outgoing: "incoming", incoming: "outgoing" } as const;

/** Projects OPA and API, a Manager, a Member and a Viewer, and one task in each project. */
async function linking() {
  const manager = testActor(
    await createTestAccount({ name: "Manager", email: "manager@example.com", role: "manager" }),
  );
  const member = testActor(
    await createTestAccount({ name: "Member", email: "member@example.com", role: "member" }),
  );
  const viewer = testActor(
    await createTestAccount({ name: "Viewer", email: "viewer@example.com", role: "viewer" }),
  );
  const opa = await createProject(manager, { key: "OPA", name: "Opanel" });
  const api = await createProject(manager, { key: "API", name: "API" });
  const a = await createTask(manager, "OPA", { title: "Checkout" });
  const b = await createTask(manager, "API", { title: "Orders endpoint" });
  return { manager, member, viewer, opa, api, a, b };
}

let agents = 0;

async function agent(
  role: "qa_agent" | "worker_agent",
  scopes: AgentScope[],
  projectIds: string[] | null,
) {
  agents += 1;
  const account = await createTestAgent({
    name: `Bot ${String(agents)}`,
    role,
    scopes,
    projectIds,
  });
  return agentActor({ accountId: account.id, role, scopes, projectIds });
}

/** The `linked` and `unlinked` entries of a task's history, oldest first. */
async function historyOf(taskId: string) {
  return getDb().$client<{ type: string; actor: string | null; old: unknown; new: unknown }[]>`
    select type, actor_account_id as actor, old_value as old, new_value as new
    from task_events where task_id = ${taskId} and type in ('linked', 'unlinked')
    order by id`;
}

/** The stored rows touching a task. */
async function rowsOf(taskId: string) {
  return getDb().$client<{ from: string; to: string; type: string; by: string | null }[]>`
    select from_task_id as from, to_task_id as to, type, created_by as by from task_links
    where ${taskId} in (from_task_id, to_task_id)
    order by type, from_task_id`;
}

const PAIRS = TASK_LINK_TYPES.filter((type) => type !== "relates_to").flatMap((type) =>
  (["outgoing", "incoming"] as const).map((direction) => [type, direction] as const),
);

describe("adding a link (WS-134)", () => {
  it.each(PAIRS)(
    "a Member adds %s %s across projects, read from both (test 3)",
    async (type, direction) => {
      const { member, a, b } = await linking();

      const answer = await addTaskLink(member, a.key, linkRequest(type, direction, b.key));

      expect(answer.id).toBe(a.id);
      expect(answer.version).toBe(a.version + 1);
      expect(answer.links).toEqual([
        { type, direction, task: { id: b.id, key: "API-1", title: "Orders endpoint" } },
      ]);
      expect((await getTask(member, b.key)).links).toEqual([
        {
          type,
          direction: READING[direction],
          task: { id: a.id, key: "OPA-1", title: "Checkout" },
        },
      ]);
      expect(await rowsOf(a.id)).toEqual([
        {
          from: direction === "outgoing" ? a.id : b.id,
          to: direction === "outgoing" ? b.id : a.id,
          type,
          by: member.accountId,
        },
      ]);
    },
  );

  it("stores relates_to once from the lower id, outgoing on both (test 4)", async () => {
    const { member, a, b } = await linking();
    const [low, high] = [a.id, b.id].sort();

    await addTaskLink(member, a.key, linkRequest("relates_to", "incoming", b.id));

    expect(await rowsOf(a.id)).toEqual([
      { from: low, to: high, type: "relates_to", by: member.accountId },
    ]);
    for (const task of [a, b]) {
      expect((await getTask(member, task.key)).links).toEqual([
        expect.objectContaining({ type: "relates_to", direction: "outgoing" }),
      ]);
    }
    for (const direction of ["outgoing", "incoming"] as const) {
      const again = await failure(
        addTaskLink(member, b.key, linkRequest("relates_to", direction, a.key)),
      );
      expect([again.status, again.code]).toEqual([409, "link_exists"]);
    }
  });

  it("refuses an existing link, and allows its reverse and a second type (test 5)", async () => {
    const { member, a, b } = await linking();
    await addTaskLink(member, a.key, linkRequest("blocks", "outgoing", b.key));

    const again = await failure(
      addTaskLink(member, b.key, linkRequest("blocks", "incoming", a.key)),
    );
    expect([again.status, again.code]).toEqual([409, "link_exists"]);

    await addTaskLink(member, b.key, linkRequest("blocks", "outgoing", a.key));
    await addTaskLink(member, a.key, linkRequest("duplicates", "outgoing", b.key));
    expect(await rowsOf(a.id)).toHaveLength(3);
  });

  it("answers one of two identical concurrent links with link_exists (test 5)", async () => {
    const { member, a, b } = await linking();

    const results = await Promise.allSettled([
      addTaskLink(member, a.key, linkRequest("blocks", "outgoing", b.key)),
      addTaskLink(member, b.key, linkRequest("blocks", "incoming", a.key)),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const [refused] = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason as ApiError] : [],
    );
    expect([refused?.status, refused?.code]).toEqual([409, "link_exists"]);
    expect(await rowsOf(a.id)).toHaveLength(1);
  });

  it("refuses no task, a missing, deleted or same other, an archived project (test 6)", async () => {
    const { manager, member, a, b } = await linking();
    const gone = await createTask(manager, "API", { title: "Gone" });
    await deleteTask(manager, gone.key);

    const missing = await failure(
      addTaskLink(member, "OPA-99", linkRequest("blocks", "outgoing", b.key)),
    );
    expect(missing.status).toBe(404);
    for (const other of ["API-99", gone.key, a.key, a.id]) {
      const refused = await failure(
        addTaskLink(member, a.key, linkRequest("blocks", "outgoing", other)),
      );
      expect([refused.status, refused.errors?.[0]?.path]).toEqual([400, "taskId"]);
    }

    await archiveProject(manager, "API");
    for (const [from, to] of [
      [a.key, b.key],
      [b.key, a.key],
    ] as const) {
      const archived = await failure(
        addTaskLink(member, from, linkRequest("blocks", "outgoing", to)),
      );
      expect([archived.status, archived.code]).toEqual([409, "project_archived"]);
    }
  });

  it("needs tasks:write and both projects in reach (test 7)", async () => {
    const { viewer, opa, a, b } = await linking();
    const qa = await agent("qa_agent", ["tasks:read", "comments:write"], null);
    const worker = await agent("worker_agent", ["tasks:read", "tasks:write"], null);
    const restricted = await agent("worker_agent", ["tasks:read", "tasks:write"], [opa.id]);

    for (const actor of [viewer, qa]) {
      const refused = await failure(
        addTaskLink(actor, a.key, linkRequest("blocks", "outgoing", b.key)),
      );
      expect(refused.status).toBe(403);
    }
    for (const [from, to] of [
      [a.key, b.key],
      [b.key, a.key],
    ] as const) {
      const added = await failure(
        addTaskLink(restricted, from, linkRequest("blocks", "outgoing", to)),
      );
      expect(added.status).toBe(403);
      const removed = await failure(
        removeTaskLink(restricted, from, linkRequest("blocks", "outgoing", to)),
      );
      expect(removed.status).toBe(403);
    }

    await addTaskLink(worker, a.key, linkRequest("duplicates", "outgoing", b.key));
    await removeTaskLink(worker, b.key, linkRequest("duplicates", "incoming", a.key));
    expect(await rowsOf(a.id)).toEqual([]);
  });

  it("refuses the 101st link on either task, not counting deleted tasks (test 8)", async () => {
    const { manager, member, a, b } = await linking();
    const others: { id: string; key: string }[] = [];
    for (let index = 0; index < MAX_TASK_LINKS; index += 1) {
      others.push(await createTask(manager, "OPA", { title: `Other ${String(index)}` }));
    }
    for (const other of others) {
      await getDb().$client`insert into task_links (from_task_id, to_task_id, type)
        values (${a.id}, ${other.id}, 'blocks')`;
    }

    const full = await failure(
      addTaskLink(member, a.key, linkRequest("blocks", "outgoing", b.key)),
    );
    expect([full.status, full.code]).toEqual([409, "too_many_links"]);
    expect(full.detail).toContain("OPA-1");
    const fromOther = await failure(
      addTaskLink(member, b.key, linkRequest("duplicates", "outgoing", a.key)),
    );
    expect([fromOther.status, fromOther.code]).toEqual([409, "too_many_links"]);

    await deleteTask(manager, others[0]?.key ?? "");
    await addTaskLink(member, a.key, linkRequest("blocks", "outgoing", b.key));
  }, 30_000);
});

describe("removing a link (WS-134)", () => {
  it("removes it from either task, and answers 404 for no such link (test 9)", async () => {
    const { member, a, b } = await linking();
    await addTaskLink(member, a.key, linkRequest("blocks", "outgoing", b.key));
    await addTaskLink(member, a.key, linkRequest("relates_to", "outgoing", b.key));

    await removeTaskLink(member, b.key, linkRequest("blocks", "incoming", a.key));
    await removeTaskLink(member, b.key, linkRequest("relates_to", "incoming", a.key));

    expect((await getTask(member, a.key)).links).toEqual([]);
    expect((await getTask(member, b.key)).links).toEqual([]);
    const none = await failure(
      removeTaskLink(member, a.key, linkRequest("blocks", "outgoing", b.key)),
    );
    expect([none.status, none.code]).toEqual([404, "not_found"]);
  });
});

describe("the history and events of a link (WS-134)", () => {
  it("writes linked and unlinked on both tasks, as each reads it (test 10)", async () => {
    const { member, a, b } = await linking();

    await addTaskLink(member, a.key, linkRequest("blocks", "outgoing", b.key));
    await removeTaskLink(member, a.key, linkRequest("blocks", "outgoing", b.key));

    const onA = { type: "blocks", direction: "outgoing", task: { id: b.id, key: "API-1" } };
    const onB = { type: "blocks", direction: "incoming", task: { id: a.id, key: "OPA-1" } };
    expect(await historyOf(a.id)).toEqual([
      { type: "linked", actor: member.accountId, old: null, new: onA },
      { type: "unlinked", actor: member.accountId, old: onA, new: null },
    ]);
    expect(await historyOf(b.id)).toEqual([
      { type: "linked", actor: member.accountId, old: null, new: onB },
      { type: "unlinked", actor: member.accountId, old: onB, new: null },
    ]);
  });

  it("writes linked on both tasks of a regression filed by triage (test 10)", async () => {
    const { closed, regressed, bot } = await regression();

    expect(await historyOf(regressed.taskId)).toEqual([
      {
        type: "linked",
        actor: bot.accountId,
        old: null,
        new: {
          type: "regression_of",
          direction: "outgoing",
          task: { id: closed.taskId, key: "OPA-1" },
        },
      },
    ]);
    expect(await historyOf(closed.taskId)).toEqual([
      {
        type: "linked",
        actor: bot.accountId,
        old: null,
        new: {
          type: "regression_of",
          direction: "incoming",
          task: { id: regressed.taskId, key: "OPA-2" },
        },
      },
    ]);
  });

  it("bumps both versions and sends task.updated in each project, a refusal nothing (test 11)", async () => {
    const { member, opa, api, a, b } = await linking();
    const listener = await listenForEvents();
    try {
      await addTaskLink(member, a.key, linkRequest("blocks", "outgoing", b.key));
      await failure(addTaskLink(member, a.key, linkRequest("blocks", "outgoing", b.key)));
      await failure(removeTaskLink(member, a.key, linkRequest("duplicates", "outgoing", b.key)));
      await removeTaskLink(member, a.key, linkRequest("blocks", "outgoing", b.key));
      await listener.settle();

      const sent = listener
        .events()
        .map((event) => [event.type, event.projectId, event.entityId, event.version]);
      expect(sent).toEqual([
        ["task.updated", opa.id, a.id, 2],
        ["task.updated", api.id, b.id, 2],
        ["task.updated", opa.id, a.id, 3],
        ["task.updated", api.id, b.id, 3],
      ]);
      expect((await getTask(member, b.key)).version).toBe(3);
      expect(await historyOf(a.id)).toHaveLength(2);
    } finally {
      await listener.close();
    }
  });
});

describe("the reach of a task's links (WS-134 section 5)", () => {
  it("leaves out a linked task outside a restricted agent's projects (test 12)", async () => {
    const { member, opa, a, b } = await linking();
    await addTaskLink(member, a.key, linkRequest("blocks", "outgoing", b.key));
    const restricted = await agent("worker_agent", ["tasks:read", "tasks:write"], [opa.id]);

    expect((await getTask(restricted, a.key)).links).toEqual([]);
    expect((await getTask(member, a.key)).links).toHaveLength(1);
  });
});
