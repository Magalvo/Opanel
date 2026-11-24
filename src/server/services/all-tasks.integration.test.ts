import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { allTasksQuerySchema, type TaskListItem } from "@/lib/schemas/tasks";
import { type Actor, agentActor } from "@/server/auth/actor";
import { createTestAccount, createTestAgent, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { ApiError } from "@/server/http/errors";

import { listColumns } from "./columns";
import { createLabel } from "./labels";
import { archiveProject, createProject } from "./projects";
import { createTask, deleteTask, listAllTasks, updateTask } from "./tasks";

// The list of tasks across projects (WS-118 tests 2 to 9).

async function setup() {
  const manager = testActor(
    await createTestAccount({ name: "Manager", email: "manager@example.com", role: "manager" }),
  );
  const mia = testActor(
    await createTestAccount({ name: "Mia", email: "mia@example.com", role: "member" }),
  );
  const opa = await createProject(manager, { key: "OPA", name: "Opanel" });
  const web = await createProject(manager, { key: "WEB", name: "Website" });
  const arc = await createProject(manager, { key: "ARC", name: "Archive" });
  await createTask(mia, "OPA", { title: "Login fails", priority: "urgent", type: "bug" });
  await createTask(mia, "OPA", { title: "Plan release", columnId: null, priority: "low" });
  await createTask(mia, "WEB", { title: "New landing page", priority: "high" });
  await createTask(mia, "WEB", { title: "Gone" });
  await deleteTask(manager, "WEB-2");
  await createTask(mia, "ARC", { title: "Old thing" });
  await archiveProject(manager, "ARC");
  return { manager, mia, opa, web, arc };
}

async function keys(actor: Actor, query: Record<string, string | string[]>) {
  const page = await listAllTasks(actor, allTasksQuerySchema.parse({ sort: "key", ...query }));
  return page.items.map((task) => task.key);
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

function restrictedTo(agentId: string, projectIds: string[]) {
  return agentActor({
    accountId: agentId,
    role: "worker_agent",
    scopes: ["projects:read", "tasks:read"],
    projectIds,
  });
}

describe("listAllTasks: the scope (WS-118 tests 2, 3 and 5)", () => {
  it("lists live tasks of every reachable, unarchived project, board and backlog", async () => {
    const { mia } = await setup();

    expect(await keys(mia, {})).toEqual(["OPA-1", "OPA-2", "WEB-1"]);
  });

  it("names projects by id or key, repeated, an archived one too", async () => {
    const { mia, web, arc } = await setup();

    expect(await keys(mia, { projectId: "OPA" })).toEqual(["OPA-1", "OPA-2"]);
    expect(await keys(mia, { projectId: [web.id, "ARC"] })).toEqual(["ARC-1", "WEB-1"]);
    expect(await keys(mia, { projectId: arc.id })).toEqual(["ARC-1"]);
  });

  it("answers 404 for an unknown project and 403 for one outside an agent's reach", async () => {
    const { mia, opa } = await setup();
    const agent = await createTestAgent({ name: "Worker", projectIds: [opa.id] });

    expect((await failure(keys(mia, { projectId: "ZZZ" }))).status).toBe(404);
    expect(
      await failure(keys(restrictedTo(agent.id, [opa.id]), { projectId: "WEB" })),
    ).toMatchObject({ status: 403, code: "forbidden" });
  });

  it("gives each item its project and its column, null in the backlog", async () => {
    const { mia, opa } = await setup();
    const [todo] = (await listColumns(mia, "OPA")).items;

    const page = await listAllTasks(
      mia,
      allTasksQuerySchema.parse({ projectId: "OPA", sort: "key" }),
    );

    expect(page.items[0]).toMatchObject({
      key: "OPA-1",
      project: { id: opa.id, key: "OPA", name: "Opanel" },
      column: { id: todo?.id, name: "To do", category: "todo" },
    });
    expect(page.items[1]).toMatchObject({ key: "OPA-2", column: null });
  });
});

describe("listAllTasks: filters across projects (WS-118 test 4)", () => {
  it("applies the filters of WS-116 across projects", async () => {
    const { mia } = await setup();

    expect(await keys(mia, { priority: ["urgent", "high"] })).toEqual(["OPA-1", "WEB-1"]);
    expect(await keys(mia, { q: "lo" })).toEqual(["OPA-1"]);
    expect(await keys(mia, { done: "false", type: "task" })).toEqual(["OPA-2", "WEB-1"]);
    expect(await keys(mia, { q: "web-1" })).toEqual(["WEB-1"]);
  });

  it("refuses a label of a project outside the scope with 400", async () => {
    const { mia, opa } = await setup();
    const webLabel = await createLabel(mia, "WEB", { name: "web", colour: "gray" });
    const opaLabel = await createLabel(mia, "OPA", { name: "opa", colour: "gray" });
    await updateTask(mia, "OPA-1", { labelIds: [opaLabel.id], version: 1 });
    const agent = await createTestAgent({ name: "Worker", projectIds: [opa.id] });

    expect(await keys(mia, { labelId: opaLabel.id })).toEqual(["OPA-1"]);
    const named = await failure(keys(mia, { projectId: "OPA", labelId: webLabel.id }));
    expect(named.status).toBe(400);
    expect(named.errors?.map((item) => item.path)).toEqual(["labelId"]);
    const reach = await failure(keys(restrictedTo(agent.id, [opa.id]), { labelId: webLabel.id }));
    expect(reach.status).toBe(400);
  });
});

/** Ten tasks over two projects with equal values to break ties on, in known order. */
async function sortable() {
  const { mia, opa, web } = await setup();
  const db = getDb();
  const values: [string, string, string, string | null, string][] = [
    // title, priority, created/updated instant, due date, project
    ["alpha", "high", "2026-01-01T10:00:00.000Z", "2030-01-01", "OPA"],
    ["Alpha", "high", "2026-01-01T10:00:00.000Z", null, "WEB"],
    ["beta", "none", "2026-01-02T10:00:00.000Z", "2030-01-01", "OPA"],
    ["Beta", "urgent", "2026-01-02T10:00:00.000Z", null, "WEB"],
    ["gamma", "low", "2026-01-03T10:00:00.000Z", "2029-06-01", "OPA"],
  ];
  for (const [title, priority, , dueDate, project] of values) {
    await createTask(mia, project, {
      title,
      priority: priority as "none",
      ...(dueDate === null ? {} : { dueDate }),
    });
  }
  // Every task, the setup's too, gets an instant from the table, so ties are on purpose.
  const all = await db.execute<{ id: string }>(sql`
    select t.id from tasks t where t.deleted_at is null order by t.created_at, t.id`);
  for (const [index, row] of all.entries()) {
    const instant = values[index % values.length]?.[2] ?? "2026-01-01T10:00:00.000Z";
    await db.execute(
      sql`update tasks set created_at = ${instant}, updated_at = ${instant} where id = ${row.id}`,
    );
  }
  return { mia, opa, web };
}

const RANK = { none: 0, low: 1, medium: 2, high: 3, urgent: 4 } as const;

function compare(sort: string) {
  const descending = sort.startsWith("-");
  const field = sort.replace(/^-/, "");
  const bytes = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return (a: TaskListItem, b: TaskListItem): number => {
    const flip = (value: number) => (descending ? -value : value);
    let order = 0;
    switch (field) {
      case "key":
        order = flip(bytes(a.project.key, b.project.key) || a.number - b.number);
        break;
      case "title":
        order = flip(bytes(a.title.toLowerCase(), b.title.toLowerCase()));
        break;
      case "priority":
        order = flip(RANK[a.priority] - RANK[b.priority]);
        break;
      case "dueDate":
        if ((a.dueDate === null) !== (b.dueDate === null)) return a.dueDate === null ? 1 : -1;
        order = flip(bytes(a.dueDate ?? "", b.dueDate ?? ""));
        break;
      case "created":
        order = flip(bytes(a.createdAt, b.createdAt));
        break;
      case "updated":
        order = flip(bytes(a.updatedAt, b.updatedAt));
        break;
    }
    return order || (descending ? -1 : 1) * bytes(a.id, b.id);
  };
}

describe("listAllTasks: sort and pages (WS-118 tests 6 to 9)", () => {
  const sorts = ["key", "title", "priority", "dueDate", "created", "updated"].flatMap((s) => [
    s,
    `-${s}`,
  ]);

  it.each(sorts)("sort=%s gives every task once, in order, over pages of 2", async (sort) => {
    const { mia } = await sortable();
    const all = (await listAllTasks(mia, allTasksQuerySchema.parse({ sort, limit: "100" }))).items;

    const paged: TaskListItem[] = [];
    let cursor: string | undefined;
    do {
      const page = await listAllTasks(
        mia,
        allTasksQuerySchema.parse({ sort, limit: "2", ...(cursor ? { cursor } : {}) }),
      );
      paged.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);

    expect(all).toHaveLength(8);
    expect(paged.map((task) => task.id)).toEqual(all.map((task) => task.id));
    expect(all.map((task) => task.id)).toEqual([...all].sort(compare(sort)).map((t) => t.id));
  });

  it("does not give a task twice when it is updated between pages of -updated", async () => {
    const { mia } = await sortable();
    const first = await listAllTasks(mia, allTasksQuerySchema.parse({ limit: "2" }));
    const moved = first.items[1];
    if (!moved || first.nextCursor === null) throw new Error("no second item");
    await updateTask(mia, moved.key, { title: "Moved up", version: moved.version });

    const seen = first.items.map((task) => task.id);
    let cursor: string | undefined = first.nextCursor;
    while (cursor !== undefined) {
      const page = await listAllTasks(mia, allTasksQuerySchema.parse({ limit: "2", cursor }));
      seen.push(...page.items.map((task) => task.id));
      cursor = page.nextCursor ?? undefined;
    }

    expect(new Set(seen).size).toBe(seen.length);
  });

  it("refuses a cursor of another sort and a tampered cursor with 400", async () => {
    const { mia } = await sortable();
    const page = await listAllTasks(mia, allTasksQuerySchema.parse({ sort: "title", limit: "2" }));
    const cursor = page.nextCursor ?? "";

    const other = await failure(
      listAllTasks(mia, allTasksQuerySchema.parse({ sort: "key", limit: "2", cursor })),
    );
    const tampered = await failure(
      listAllTasks(mia, allTasksQuerySchema.parse({ sort: "title", cursor: "bm9wZQ" })),
    );

    expect(other.errors).toEqual([{ path: "cursor", message: "Invalid cursor." }]);
    expect(tampered.status).toBe(400);
  });

  it("gives a restricted agent full pages of its projects only", async () => {
    const { opa } = await sortable();
    const agent = await createTestAgent({ name: "Worker", projectIds: [opa.id] });
    const actor = restrictedTo(agent.id, [opa.id]);

    const sizes: number[] = [];
    const projects = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await listAllTasks(
        actor,
        allTasksQuerySchema.parse({ limit: "2", ...(cursor ? { cursor } : {}) }),
      );
      sizes.push(page.items.length);
      for (const task of page.items) projects.add(task.project.key);
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);

    expect([...projects]).toEqual(["OPA"]);
    expect(sizes).toEqual([2, 2, 1]);
  });
});
