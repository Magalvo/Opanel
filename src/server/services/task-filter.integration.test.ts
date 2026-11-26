import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { submitBugReportRequestSchema } from "@/lib/schemas/bug-reports";
import { backlogQuerySchema, taskListQuerySchema } from "@/lib/schemas/tasks";
import { type Actor, agentActor } from "@/server/auth/actor";
import { createTestAccount, createTestAgent, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { ApiError } from "@/server/http/errors";

import { fileBugReport } from "./bug-reports";
import { listColumns } from "./columns";
import { createEpic } from "./epics";
import { createLabel } from "./labels";
import { createProject } from "./projects";
import {
  createTask,
  deleteTask,
  getTask,
  listBacklog,
  listTasks,
  moveTask,
  updateTask,
} from "./tasks";
import { createTeam } from "./teams";

// The filters and the text search of the project lists (WS-116 tests 2 to 9).

/**
 * OPA-1 to OPA-4 by people, OPA-5 filed by an agent. The board, in order: OPA-5 and OPA-1
 * in "To do", OPA-2 in "In progress", OPA-3 in "Done"; OPA-4 is in the backlog.
 */
async function setup() {
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
  const project = await createProject(manager, { key: "OPA", name: "Opanel" });
  const [todo, progress, done] = (await listColumns(manager, "OPA")).items.map((c) => c.id);
  if (!todo || !progress || !done) throw new Error("no columns");
  const team = await createTeam(manager, { name: "Frontend" });
  const epic = await createEpic(manager, "OPA", { title: "Launch" });
  const red = await createLabel(mia, "OPA", { name: "red", colour: "red" });
  const blue = await createLabel(mia, "OPA", { name: "blue", colour: "blue" });

  await createTask(mia, "OPA", {
    title: "Login fails on Safari",
    type: "bug",
    severity: "high",
    priority: "urgent",
    columnId: todo,
    assigneeAccountId: miaAccount.id,
    assigneeTeamId: team.id,
    epicId: epic.id,
    labelIds: [red.id],
    dueDate: "2030-01-10",
  });
  await createTask(manager, "OPA", {
    title: "Write release notes",
    description: "Mention the dashboard.",
    type: "story",
    priority: "low",
    columnId: progress,
    labelIds: [blue.id],
    dueDate: "2030-02-01",
  });
  await createTask(mia, "OPA", { title: "Archive old boards", columnId: done });
  await createTask(manager, "OPA", {
    title: "Logout button",
    priority: "high",
    columnId: null,
    dueDate: "2029-12-31",
  });

  const scopes = ["projects:read", "tasks:read", "reports:write"] as const;
  const agent = await createTestAgent({ name: "QA Bot", role: "qa_agent", scopes: [...scopes] });
  const bot = agentActor({ accountId: agent.id, role: "qa_agent", scopes, projectIds: null });
  await fileBugReport(
    bot,
    "OPA",
    submitBugReportRequestSchema.parse({ title: "Checkout returns 500", fingerprint: "f-1" }),
  );

  return { manager, mia, miaAccount, bot, project, todo, progress, done, team, epic, red, blue };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function board(actor: Actor, query: Record<string, string | string[]>) {
  const page = await listTasks(actor, "OPA", taskListQuerySchema.parse(query));
  return page.items.map((task) => task.key);
}

async function backlog(actor: Actor, query: Record<string, string | string[]>) {
  const page = await listBacklog(actor, "OPA", backlogQuerySchema.parse(query));
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

describe("the board list's filters, one at a time (WS-116 test 2)", () => {
  const cases: [string, (s: Setup) => Record<string, string | string[]>, string[]][] = [
    ["no filter", () => ({}), ["OPA-5", "OPA-1", "OPA-2", "OPA-3"]],
    ["type", () => ({ type: "bug" }), ["OPA-5", "OPA-1"]],
    ["category", () => ({ category: "in_progress" }), ["OPA-2"]],
    ["done=true", () => ({ done: "true" }), ["OPA-3"]],
    ["done=false", () => ({ done: "false" }), ["OPA-5", "OPA-1", "OPA-2"]],
    ["columnId", (s) => ({ columnId: s.todo }), ["OPA-5", "OPA-1"]],
    ["assigneeTeamId", (s) => ({ assigneeTeamId: s.team.id }), ["OPA-1"]],
    ["assigneeAccountId", (s) => ({ assigneeAccountId: s.miaAccount.id }), ["OPA-1"]],
    ["reporterAccountId", (s) => ({ reporterAccountId: s.miaAccount.id }), ["OPA-1", "OPA-3"]],
    ["reporterKind=agent", () => ({ reporterKind: "agent" }), ["OPA-5"]],
    ["reporterKind=human", () => ({ reporterKind: "human" }), ["OPA-1", "OPA-2", "OPA-3"]],
    ["labelId", (s) => ({ labelId: s.red.id }), ["OPA-1"]],
    ["epicId", (s) => ({ epicId: s.epic.id }), ["OPA-1"]],
    ["priority", () => ({ priority: "urgent" }), ["OPA-1"]],
    ["severity", () => ({ severity: "high" }), ["OPA-1"]],
    ["dueFrom", () => ({ dueFrom: "2030-01-15" }), ["OPA-2"]],
    ["dueTo", () => ({ dueTo: "2030-01-10" }), ["OPA-1"]],
  ];

  it.each(cases)("%s", async (_name, query, keys) => {
    const s = await setup();
    expect(await board(s.mia, query(s))).toEqual(keys);
  });
});

describe("the board list's filters together (WS-116 tests 3 and 4)", () => {
  it("keeps any value of a repeated parameter and all of different parameters", async () => {
    const s = await setup();

    expect(await board(s.mia, { type: ["bug", "story"] })).toEqual(["OPA-5", "OPA-1", "OPA-2"]);
    expect(await board(s.mia, { labelId: [s.red.id, s.blue.id] })).toEqual(["OPA-1", "OPA-2"]);
    expect(await board(s.mia, { type: "bug", priority: "urgent" })).toEqual(["OPA-1"]);
    expect(await board(s.mia, { type: "bug", priority: "none" })).toEqual(["OPA-5"]);
    expect(await board(s.mia, { dueFrom: "2030-01-01", dueTo: "2030-01-31" })).toEqual(["OPA-1"]);
  });

  it("pages a filtered list in board order", async () => {
    const s = await setup();
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listTasks(
        s.mia,
        "OPA",
        taskListQuerySchema.parse({
          type: ["bug", "story"],
          limit: "1",
          ...(cursor ? { cursor } : {}),
        }),
      );
      keys.push(...page.items.map((task) => task.key));
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);

    expect(keys).toEqual(["OPA-5", "OPA-1", "OPA-2"]);
  });

  it("reads none, me for a person and for an agent, and the backlog among deleted tasks", async () => {
    const s = await setup();

    expect(await board(s.mia, { assigneeTeamId: "none" })).toEqual(["OPA-5", "OPA-2", "OPA-3"]);
    expect(await board(s.mia, { assigneeAccountId: ["none", s.miaAccount.id] })).toEqual([
      "OPA-5",
      "OPA-1",
      "OPA-2",
      "OPA-3",
    ]);
    expect(await board(s.mia, { epicId: "none" })).toEqual(["OPA-5", "OPA-2", "OPA-3"]);
    expect(await board(s.mia, { assigneeAccountId: "me" })).toEqual(["OPA-1"]);
    expect(await board(s.mia, { reporterAccountId: "me" })).toEqual(["OPA-1", "OPA-3"]);
    expect(await board(s.bot, { reporterAccountId: "me" })).toEqual(["OPA-5"]);
    expect(await board(s.mia, { columnId: "backlog" })).toEqual([]);

    await deleteTask(s.manager, "OPA-4");
    await deleteTask(s.manager, "OPA-3");
    expect(await board(s.manager, { deleted: "true", columnId: "backlog" })).toEqual(["OPA-4"]);
    expect(await board(s.manager, { deleted: "true", done: "true" })).toEqual(["OPA-3"]);
  });
});

describe("the backlog's filters (WS-116 test 5)", () => {
  it("leaves tasks out and keeps the backlog order", async () => {
    const s = await setup();
    await createTask(s.mia, "OPA", { title: "Later", columnId: null, priority: "high" });
    await createTask(s.mia, "OPA", { title: "Low", columnId: null, priority: "low" });

    expect(await backlog(s.mia, { priority: "high" })).toEqual(["OPA-4", "OPA-6"]);
    expect(await backlog(s.mia, { done: "false", reporterAccountId: "me" })).toEqual([
      "OPA-6",
      "OPA-7",
    ]);
    expect(await backlog(s.mia, { category: "todo" })).toEqual([]);
    expect(await backlog(s.mia, { q: "logout" })).toEqual(["OPA-4"]);
  });
});

describe("the backlog's filters, one at a time (WS-131 test 5)", () => {
  /** The setup with OPA-1, OPA-2 and OPA-5 moved to the backlog, after OPA-4, in that order. */
  async function backlogSetup(): Promise<Setup> {
    const s = await setup();
    for (const key of ["OPA-1", "OPA-2", "OPA-5"]) {
      const { version } = await getTask(s.manager, key);
      await moveTask(s.manager, key, { columnId: null, version });
    }
    return s;
  }

  const cases: [string, (s: Setup) => Record<string, string | string[]>, string[]][] = [
    ["no filter", () => ({}), ["OPA-4", "OPA-1", "OPA-2", "OPA-5"]],
    ["q", () => ({ q: "login" }), ["OPA-1"]],
    ["type", () => ({ type: "bug" }), ["OPA-1", "OPA-5"]],
    ["category: a backlog task has none", () => ({ category: "todo" }), []],
    ["done=true: a backlog task is never done", () => ({ done: "true" }), []],
    ["done=false", () => ({ done: "false" }), ["OPA-4", "OPA-1", "OPA-2", "OPA-5"]],
    ["assigneeTeamId", (s) => ({ assigneeTeamId: s.team.id }), ["OPA-1"]],
    ["assigneeAccountId", (s) => ({ assigneeAccountId: s.miaAccount.id }), ["OPA-1"]],
    ["reporterAccountId", (s) => ({ reporterAccountId: s.miaAccount.id }), ["OPA-1"]],
    ["reporterKind=agent", () => ({ reporterKind: "agent" }), ["OPA-5"]],
    ["reporterKind=human", () => ({ reporterKind: "human" }), ["OPA-4", "OPA-1", "OPA-2"]],
    ["labelId", (s) => ({ labelId: s.blue.id }), ["OPA-2"]],
    ["epicId", (s) => ({ epicId: s.epic.id }), ["OPA-1"]],
    ["priority", () => ({ priority: "high" }), ["OPA-4"]],
    ["severity", () => ({ severity: "high" }), ["OPA-1"]],
    ["dueFrom", () => ({ dueFrom: "2030-01-15" }), ["OPA-2"]],
    ["dueTo", () => ({ dueTo: "2030-01-10" }), ["OPA-4", "OPA-1"]],
  ];

  it.each(cases)("%s", async (_name, query, keys) => {
    const s = await backlogSetup();
    expect(await backlog(s.mia, query(s))).toEqual(keys);
  });
});

describe("ids of another project (WS-116 test 6)", () => {
  it("refuses a column, label or epic of another project with 400 on its field", async () => {
    const s = await setup();
    await createProject(s.manager, { key: "WEB", name: "Web" });
    const [webColumn] = (await listColumns(s.manager, "WEB")).items;
    const webLabel = await createLabel(s.mia, "WEB", { name: "web", colour: "gray" });
    const webEpic = await createEpic(s.manager, "WEB", { title: "Web" });

    for (const [field, id] of [
      ["columnId", webColumn?.id ?? ""],
      ["labelId", webLabel.id],
      ["epicId", webEpic.id],
    ] as const) {
      const error = await failure(board(s.mia, { [field]: id }));
      expect(error.status, field).toBe(400);
      expect(
        error.errors?.map((item) => item.path),
        field,
      ).toEqual([field]);
    }
    const inBacklog = await failure(backlog(s.mia, { labelId: webLabel.id }));
    expect(inBacklog.status).toBe(400);
  });

  it("matches nothing for an unknown account or team", async () => {
    const s = await setup();
    const unknown = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";

    expect(await board(s.mia, { assigneeAccountId: unknown })).toEqual([]);
    expect(await board(s.mia, { assigneeTeamId: unknown })).toEqual([]);
    expect(await board(s.mia, { reporterAccountId: unknown })).toEqual([]);
  });
});

describe("text search (WS-116 tests 7 to 9)", () => {
  it("finds a key, words, a prefix and words of the description", async () => {
    const s = await setup();

    expect(await board(s.mia, { q: "opa-2" })).toEqual(["OPA-2"]);
    expect(await board(s.mia, { q: "OPA-4" })).toEqual([]);
    expect(await backlog(s.mia, { q: "OPA-4" })).toEqual(["OPA-4"]);
    expect(await board(s.mia, { q: "safari login" })).toEqual(["OPA-1"]);
    expect(await board(s.mia, { q: "log" })).toEqual(["OPA-1"]);
    expect(await board(s.mia, { q: "fails log" })).toEqual(["OPA-1"]);
    expect(await board(s.mia, { q: "dash" })).toEqual(["OPA-2"]);
    expect(await board(s.mia, { q: "release, notes!" })).toEqual(["OPA-2"]);
    expect(await board(s.mia, { q: "nothing" })).toEqual([]);
    expect(await board(s.mia, { q: "login", type: "story" })).toEqual([]);
  });

  it("finds a task by its new title as soon as it is renamed", async () => {
    const s = await setup();
    const task = await listTasks(s.mia, "OPA", taskListQuerySchema.parse({ q: "archive" }));
    const [archived] = task.items;
    if (!archived) throw new Error("not found");

    await updateTask(s.mia, "OPA-3", { title: "Purge boards", version: archived.version });

    expect(await board(s.mia, { q: "purge" })).toEqual(["OPA-3"]);
    expect(await board(s.mia, { q: "archive" })).toEqual([]);
  });

  it("finds a task by the new words of its description as soon as it is edited (WS-131)", async () => {
    const s = await setup();
    const { version } = await getTask(s.mia, "OPA-2");

    await updateTask(s.mia, "OPA-2", { description: "Mention the changelog.", version });

    expect(await board(s.mia, { q: "changelog" })).toEqual(["OPA-2"]);
    expect(await board(s.mia, { q: "dashboard" })).toEqual([]);
  });

  it("finds a task written by SQL alone: the database computes the column", async () => {
    const s = await setup();
    await getDb().execute(sql`
      insert into tasks (project_id, number, title, column_id, position, reporter_account_id)
      values (${s.project.id}, 99, 'Raw searchable row', null, 'zzz', ${s.miaAccount.id})`);

    expect(await backlog(s.mia, { q: "searchable" })).toEqual(["OPA-99"]);
  });
});
