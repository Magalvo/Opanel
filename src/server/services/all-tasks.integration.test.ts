import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { submitBugReportRequestSchema } from "@/lib/schemas/bug-reports";
import { allTasksQuerySchema, type TaskListItem } from "@/lib/schemas/tasks";
import { type Actor, agentActor } from "@/server/auth/actor";
import { createTestAccount, createTestAgent, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { ApiError } from "@/server/http/errors";
import { decodeTaskListCursor, encodeTaskListCursor } from "@/server/http/pagination";

import { fileBugReport } from "./bug-reports";
import { listColumns } from "./columns";
import { createEpic } from "./epics";
import { createLabel } from "./labels";
import { archiveProject, createProject, updateProject } from "./projects";
import { recordingDb } from "./recording-db-testing";
import { createSprint } from "./sprints";
import { createTask, deleteTask, listAllTasks, updateTask } from "./tasks";
import { createTeam } from "./teams";

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
  // Story points with ties, none for some, by the same turn (WS-139 test 7).
  const points = [3, null, 0.5, 3, 13] as const;
  for (const [index, row] of all.entries()) {
    const instant = values[index % values.length]?.[2] ?? "2026-01-01T10:00:00.000Z";
    const storyPoints = points[index % points.length] ?? null;
    await db.execute(
      sql`update tasks set created_at = ${instant}, updated_at = ${instant},
          story_points = ${storyPoints} where id = ${row.id}`,
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
      case "storyPoints":
        if ((a.storyPoints === null) !== (b.storyPoints === null)) {
          return a.storyPoints === null ? 1 : -1;
        }
        order = flip((a.storyPoints ?? 0) - (b.storyPoints ?? 0));
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

describe("listAllTasks: the parentId filter (WS-133 test 12)", () => {
  it("keeps a parent's sub-tasks across projects, or the tasks with no parent", async () => {
    const { mia } = await setup();
    const child = await listAllTasks(mia, allTasksQuerySchema.parse({ q: "OPA-2" }));
    const version = child.items[0]?.version ?? 0;
    await updateTask(mia, "OPA-2", { parentId: "OPA-1", version });

    expect(await keys(mia, { parentId: "OPA-1" })).toEqual(["OPA-2"]);
    expect(await keys(mia, { parentId: "none" })).toEqual(["OPA-1", "WEB-1"]);
    expect(await keys(mia, { parentId: "WEB-1" })).toEqual([]);
  });
});

describe("listAllTasks: each filter across projects (WS-131 test 6)", () => {
  /**
   * In OPA and in WEB alike: task 1 on the board matches every filter below, task 2 in the
   * backlog matches none of them but `done=false`, `reporterKind=human` and its own due
   * date. OPA-3 is a bug an agent filed; WEB has no such task.
   */
  async function setupEach() {
    const managerAccount = await createTestAccount({
      name: "Manager",
      email: "manager@example.com",
      role: "manager",
    });
    const manager = testActor(managerAccount);
    const miaAccount = await createTestAccount({
      name: "Mia",
      email: "mia@example.com",
      role: "member",
    });
    const mia = testActor(miaAccount);
    const team = await createTeam(manager, { name: "Frontend" });
    const labels: string[] = [];
    const epics: string[] = [];
    for (const key of ["OPA", "WEB"]) {
      await createProject(manager, { key, name: key });
      const label = await createLabel(mia, key, { name: "red", colour: "red" });
      const epic = await createEpic(manager, key, { title: "Launch" });
      labels.push(label.id);
      epics.push(epic.id);
      await createTask(mia, key, {
        title: "Login fails on Safari",
        type: "bug",
        severity: "high",
        priority: "urgent",
        assigneeAccountId: miaAccount.id,
        assigneeTeamId: team.id,
        epicId: epic.id,
        labelIds: [label.id],
        dueDate: "2030-01-10",
      });
      await createTask(manager, key, {
        title: "Plain notes",
        type: "story",
        priority: "low",
        columnId: null,
        dueDate: "2030-02-01",
      });
    }
    const scopes = ["projects:read", "tasks:read", "reports:write"] as const;
    const agent = await createTestAgent({ name: "QA Bot", role: "qa_agent", scopes: [...scopes] });
    const bot = agentActor({ accountId: agent.id, role: "qa_agent", scopes, projectIds: null });
    await fileBugReport(
      bot,
      "OPA",
      submitBugReportRequestSchema.parse({ title: "Checkout returns 500", fingerprint: "f-1" }),
    );
    return { mia, miaAccount, team, labels, epics };
  }

  type Each = Awaited<ReturnType<typeof setupEach>>;

  const cases: [string, (s: Each) => Record<string, string | string[]>, string[]][] = [
    ["no filter", () => ({}), ["OPA-1", "OPA-2", "OPA-3", "WEB-1", "WEB-2"]],
    ["q", () => ({ q: "login" }), ["OPA-1", "WEB-1"]],
    ["type", () => ({ type: "bug" }), ["OPA-1", "OPA-3", "WEB-1"]],
    ["category", () => ({ category: "todo" }), ["OPA-1", "OPA-3", "WEB-1"]],
    ["done=true", () => ({ done: "true" }), []],
    ["done=false", () => ({ done: "false" }), ["OPA-1", "OPA-2", "OPA-3", "WEB-1", "WEB-2"]],
    ["assigneeTeamId", (s) => ({ assigneeTeamId: s.team.id }), ["OPA-1", "WEB-1"]],
    ["assigneeAccountId", (s) => ({ assigneeAccountId: s.miaAccount.id }), ["OPA-1", "WEB-1"]],
    ["reporterAccountId", (s) => ({ reporterAccountId: s.miaAccount.id }), ["OPA-1", "WEB-1"]],
    ["reporterKind=agent", () => ({ reporterKind: "agent" }), ["OPA-3"]],
    ["reporterKind=human", () => ({ reporterKind: "human" }), ["OPA-1", "OPA-2", "WEB-1", "WEB-2"]],
    ["labelId, one per project", (s) => ({ labelId: s.labels }), ["OPA-1", "WEB-1"]],
    ["epicId, one per project", (s) => ({ epicId: s.epics }), ["OPA-1", "WEB-1"]],
    ["priority", () => ({ priority: "urgent" }), ["OPA-1", "WEB-1"]],
    ["severity", () => ({ severity: "high" }), ["OPA-1", "WEB-1"]],
    ["dueFrom", () => ({ dueFrom: "2030-01-15" }), ["OPA-2", "WEB-2"]],
    ["dueTo", () => ({ dueTo: "2030-01-10" }), ["OPA-1", "WEB-1"]],
    ["projectId", () => ({ projectId: "WEB" }), ["WEB-1", "WEB-2"]],
  ];

  it.each(cases)("%s", async (_name, query, expected) => {
    const s = await setupEach();
    expect(await keys(s.mia, query(s))).toEqual(expected);
  });
});

describe("listAllTasks: sort and pages (WS-118 tests 6 to 9)", () => {
  const sorts = [
    "key",
    "title",
    "priority",
    "dueDate",
    "storyPoints",
    "created",
    "updated",
  ].flatMap((s) => [s, `-${s}`]);

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

  it.each(sorts)(
    "sort=%s gives every task left alone once while others are written between pages (WS-131)",
    async (sort) => {
      const { mia } = await sortable();
      const before = (await listAllTasks(mia, allTasksQuerySchema.parse({ sort, limit: "100" })))
        .items;
      const first = await listAllTasks(mia, allTasksQuerySchema.parse({ sort, limit: "2" }));
      if (first.nextCursor === null) throw new Error("one page only");

      // Between the pages: a new task, and a change to one task of the first page.
      await createTask(mia, "OPA", { title: "Arrived meanwhile", priority: "urgent" });
      const [changed] = first.items;
      if (!changed) throw new Error("empty page");
      await updateTask(mia, changed.key, {
        title: "Changed meanwhile",
        priority: "low",
        version: changed.version,
      });

      const seen = first.items.map((task) => task.id);
      let cursor: string | undefined = first.nextCursor;
      while (cursor !== undefined) {
        const page = await listAllTasks(
          mia,
          allTasksQuerySchema.parse({ sort, limit: "2", cursor }),
        );
        seen.push(...page.items.map((task) => task.id));
        cursor = page.nextCursor ?? undefined;
      }

      const leftAlone = before.map((task) => task.id).filter((id) => id !== changed.id);
      for (const id of leftAlone) {
        expect(
          seen.filter((seenId) => seenId === id),
          id,
        ).toHaveLength(1);
      }
    },
  );

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

  // WS-121 tests 1 and 2: a real cursor with only its date changed.
  async function withDate(actor: Actor, sort: string, date: string): Promise<string> {
    const page = await listAllTasks(actor, allTasksQuerySchema.parse({ sort, limit: "1" }));
    const field = sort.replace(/^-/, "");
    const cursor = decodeTaskListCursor(page.nextCursor ?? "", sort, field === "dueDate" ? 2 : 1);
    const values = field === "dueDate" ? ["false", date] : [date];
    return encodeTaskListCursor({ ...cursor, values });
  }

  it("refuses a created or updated cursor that is no real instant with 400 (WS-121)", async () => {
    const { mia } = await sortable();
    for (const sort of ["created", "-created", "updated", "-updated"]) {
      for (const instant of [
        "2026-02-30T12:00:00.000000Z",
        "2026-13-01T12:00:00.000000Z",
        "2026-11-32T12:00:00.000000Z",
        "2026-11-12T24:00:00.000000Z",
        "2026-11-12T25:00:00.000000Z",
        "2026-11-12T10:60:00.000000Z",
        "2026-11-12T10:00:60.000000Z",
        "0000-01-01T00:00:00.000000Z",
      ]) {
        const cursor = await withDate(mia, sort, instant);
        const error = await failure(
          listAllTasks(mia, allTasksQuerySchema.parse({ sort, limit: "1", cursor })),
        );
        expect(error.status, `${sort} ${instant}`).toBe(400);
        expect(error.errors, `${sort} ${instant}`).toEqual([
          { path: "cursor", message: "Invalid cursor." },
        ]);
      }
    }
  });

  it("refuses a dueDate cursor that is no calendar date with 400 (WS-121)", async () => {
    const { mia } = await sortable();
    for (const sort of ["dueDate", "-dueDate"]) {
      for (const date of ["2026-02-30", "2026-13-01", "2026-11-32", "2026-02-29", "0000-01-01"]) {
        const cursor = await withDate(mia, sort, date);
        const error = await failure(
          listAllTasks(mia, allTasksQuerySchema.parse({ sort, limit: "1", cursor })),
        );
        expect(error.status, `${sort} ${date}`).toBe(400);
        expect(error.errors, `${sort} ${date}`).toEqual([
          { path: "cursor", message: "Invalid cursor." },
        ]);
      }
    }
  });

  it("puts tasks with no story points last both ways, and pages through them (WS-139 test 7)", async () => {
    const { mia } = await sortable();
    for (const sort of ["storyPoints", "-storyPoints"]) {
      const whole = await listAllTasks(mia, allTasksQuerySchema.parse({ sort, limit: "100" }));
      const points = whole.items.map((task) => task.storyPoints);
      expect(points, sort).toEqual(
        sort === "storyPoints"
          ? [0.5, 0.5, 3, 3, 3, 13, null, null]
          : [13, 3, 3, 3, 0.5, 0.5, null, null],
      );
      const ids: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await listAllTasks(
          mia,
          allTasksQuerySchema.parse({ sort, limit: "1", ...(cursor ? { cursor } : {}) }),
        );
        ids.push(...page.items.map((task) => task.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);
      expect(ids, sort).toEqual(whole.items.map((task) => task.id));
    }
  });

  it("refuses a storyPoints cursor whose value is no number of points with 400 (WS-139)", async () => {
    const { mia } = await sortable();
    for (const sort of ["storyPoints", "-storyPoints"]) {
      const page = await listAllTasks(mia, allTasksQuerySchema.parse({ sort, limit: "1" }));
      const cursor = decodeTaskListCursor(page.nextCursor ?? "", sort, 2);
      for (const value of ["-1", "1e3", "abc", "1000", "1.25"]) {
        const tampered = encodeTaskListCursor({ ...cursor, values: ["false", value] });
        const error = await failure(
          listAllTasks(mia, allTasksQuerySchema.parse({ sort, limit: "1", cursor: tampered })),
        );
        expect(error.status, `${sort} ${value}`).toBe(400);
      }
    }
  });

  it("pages over a leap day and over tasks with no due date (WS-121 test 3)", async () => {
    const { mia } = await setup();
    await updateTask(mia, "OPA-1", { dueDate: "2028-02-29", version: 1 });
    await getDb().execute(sql`update tasks set
      created_at = timestamptz '2028-02-29 12:00:00.123456+00' + (number * interval '1 second'),
      updated_at = timestamptz '2028-02-29 23:59:59.999999+00' - (number * interval '1 hour')`);

    for (const sort of ["created", "-created", "updated", "-updated", "dueDate", "-dueDate"]) {
      const whole = await listAllTasks(mia, allTasksQuerySchema.parse({ sort, limit: "100" }));
      const ids: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await listAllTasks(
          mia,
          allTasksQuerySchema.parse({ sort, limit: "1", ...(cursor ? { cursor } : {}) }),
        );
        ids.push(...page.items.map((task) => task.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);

      expect(ids, sort).toEqual(whole.items.map((task) => task.id));
      expect(ids, sort).toHaveLength(3);
    }
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

describe("what listAllTasks takes from the database (WS-122 test 3)", () => {
  it("reads no description, for every sort, on either page", async () => {
    const { mia } = await sortable();
    await updateTask(mia, "OPA-1", { description: "A long description", version: 1 });
    const recording = recordingDb();

    for (const field of ["key", "title", "priority", "dueDate", "created", "updated"]) {
      for (const sort of [field, `-${field}`]) {
        const first = await listAllTasks(
          mia,
          allTasksQuerySchema.parse({ sort, limit: "2" }),
          recording.db,
        );
        await listAllTasks(
          mia,
          allTasksQuerySchema.parse({ sort, limit: "2", cursor: first.nextCursor ?? "" }),
          recording.db,
        );
      }
    }

    expect(recording.taskRows()).not.toHaveLength(0);
    for (const row of recording.taskRows()) expect(Object.keys(row)).not.toContain("description");
  });
});

describe("the sprintId filter across projects (WS-141 test 20)", () => {
  it("keeps each project's active sprint with active, and a sprint by its id", async () => {
    const { manager, mia } = await setup();
    const dates = { startDate: "2026-12-01", endDate: "2026-12-14" };
    const sprints = [];
    for (const key of ["OPA", "WEB"]) {
      await updateProject(manager, key, { sprintsEnabled: true, version: 1 });
      const sprint = await createSprint(manager, key, { name: `${key} 1`, ...dates });
      await getDb().execute(
        sql`update sprints set state = 'active', started_at = now() where id = ${sprint.id}`,
      );
      sprints.push(sprint);
    }
    const opa = await createTask(mia, "OPA", { title: "In OPA", sprintId: sprints[0]?.id ?? "" });
    const web = await createTask(mia, "WEB", { title: "In WEB", sprintId: sprints[1]?.id ?? "" });

    const keys = async (query: Record<string, unknown>) =>
      (await listAllTasks(mia, allTasksQuerySchema.parse({ sort: "key", ...query }))).items.map(
        (t) => t.key,
      );
    expect(await keys({ sprintId: "active" })).toEqual([opa.key, web.key]);
    expect(await keys({ sprintId: sprints[1]?.id })).toEqual([web.key]);
    expect(await keys({ sprintId: "none" })).toEqual(["OPA-1", "OPA-2", "WEB-1"]);
  });
});
