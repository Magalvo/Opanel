import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { ActivityItem, ActivityPage } from "@/lib/schemas/activity";
import { submitBugReportRequestSchema } from "@/lib/schemas/bug-reports";
import { agentActor } from "@/server/auth/actor";
import { createTestAccount, createTestAgent, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { ApiError } from "@/server/http/errors";

import { listActivity } from "./activity";
import { fileBugReport } from "./bug-reports";
import { createColumn, deleteColumn, listColumns } from "./columns";
import { createComment } from "./comments";
import { createEpic } from "./epics";
import { createLabel, deleteLabel } from "./labels";
import { createProject, updateProject } from "./projects";
import { createSprint, deleteSprint } from "./sprints";
import { addTaskLink, removeTaskLink } from "./task-links";
import { createTask, deleteTask, moveTask, restoreTask, updateTask } from "./tasks";
import { createTeam, deleteTeam, renameTeam } from "./teams";

// A task's activity: its history and its comments in one list (WS-117).

async function setup() {
  const managerAccount = await createTestAccount({
    name: "Manager",
    email: "manager@example.com",
    role: "manager",
  });
  const manager = testActor(managerAccount);
  const memberAccount = await createTestAccount({
    name: "Mia",
    email: "mia@example.com",
    role: "member",
  });
  const member = testActor(memberAccount);
  const project = await createProject(manager, { key: "OPA", name: "Opanel" });
  const columns = (await listColumns(manager, "OPA")).items;
  const task = await createTask(member, "OPA", { title: "First" });
  return { manager, managerAccount, member, memberAccount, project, columns, task };
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

function events(page: ActivityPage) {
  return page.items.flatMap((item) => (item.kind === "event" ? [item] : []));
}

function change(page: ActivityPage, field: string) {
  return events(page).find((item) => item.type === "field_changed" && item.field === field);
}

function describeItem(item: ActivityItem): string {
  if (item.kind === "comment") return `comment:${item.comment.body}`;
  return item.field === null ? item.type : `${item.type}:${item.field}`;
}

describe("listActivity (WS-117)", () => {
  it("lists history and comments in order, with no commented entry", async () => {
    const { member, memberAccount, columns, task } = await setup();
    const edited = await updateTask(member, "OPA-1", { title: "Renamed", version: task.version });
    await createComment(member, "OPA-1", { body: "Seen" });
    const second = columns[1];
    if (!second) throw new Error("no second column");
    await moveTask(member, "OPA-1", { columnId: second.id, version: edited.version });

    const page = await listActivity(member, "OPA-1", { limit: 50 });

    expect(page.items.map(describeItem)).toEqual([
      "created",
      "field_changed:title",
      "comment:Seen",
      "moved",
    ]);
    expect(page.nextCursor).toBeNull();
    expect(events(page)[0]).toMatchObject({
      type: "created",
      actor: { id: memberAccount.id, name: "Mia", kind: "human" },
      newValue: { key: "OPA-1", title: "First", column: { id: columns[0]?.id, name: "To do" } },
    });
    expect(events(page)[0]?.newValue).not.toHaveProperty("columnId");
    expect(change(page, "title")).toMatchObject({ oldValue: "First", newValue: "Renamed" });
    expect(events(page).at(-1)).toMatchObject({
      type: "moved",
      oldValue: { column: { id: columns[0]?.id, name: "To do" } },
      newValue: { column: { id: second.id, name: "In progress" } },
    });
  });

  it("names assignees, teams and epics, and answers other fields as stored", async () => {
    const { manager, member, memberAccount, task } = await setup();
    const team = await createTeam(manager, { name: "Frontend" });
    const epic = await createEpic(manager, "OPA", { title: "Launch" });
    const label = await createLabel(member, "OPA", { name: "release", colour: "red" });

    await updateTask(member, "OPA-1", {
      description: "Steps",
      type: "bug",
      severity: "high",
      priority: "urgent",
      dueDate: "2030-06-10",
      assigneeTeamId: team.id,
      assigneeAccountId: memberAccount.id,
      epicId: epic.id,
      labelIds: [label.id],
      version: task.version,
    });
    const page = await listActivity(member, "OPA-1", { limit: 50 });

    expect(change(page, "description")).toMatchObject({ oldValue: "", newValue: "Steps" });
    expect(change(page, "type")).toMatchObject({ oldValue: "task", newValue: "bug" });
    expect(change(page, "severity")).toMatchObject({ oldValue: null, newValue: "high" });
    expect(change(page, "priority")).toMatchObject({ oldValue: "none", newValue: "urgent" });
    expect(change(page, "dueDate")).toMatchObject({ oldValue: null, newValue: "2030-06-10" });
    expect(change(page, "assigneeTeamId")).toMatchObject({
      oldValue: null,
      newValue: { id: team.id, name: "Frontend" },
    });
    expect(change(page, "assigneeAccountId")).toMatchObject({
      oldValue: null,
      newValue: { id: memberAccount.id, name: "Mia", kind: "human" },
    });
    expect(change(page, "epicId")).toMatchObject({
      oldValue: null,
      newValue: { id: epic.id, name: "Launch" },
    });
    expect(change(page, "labels")).toMatchObject({
      oldValue: [],
      newValue: [{ id: label.id, name: "release" }],
    });
  });

  it("names a parent by its key, a deleted parent too (WS-133 test 13)", async () => {
    const { manager, member, task } = await setup();
    const parent = await createTask(member, "OPA", { title: "Parent" });

    const attached = await updateTask(member, "OPA-1", {
      parentId: parent.key,
      version: task.version,
    });
    await updateTask(member, "OPA-1", { parentId: null, version: attached.version });
    await deleteTask(manager, parent.key);
    const page = await listActivity(member, "OPA-1", { limit: 50 });

    const changes = page.items.filter((item) => item.kind === "event" && item.field === "parentId");
    expect(
      changes.map((item) => (item.kind === "event" ? [item.oldValue, item.newValue] : [])),
    ).toEqual([
      [null, { id: parent.id, name: parent.key }],
      [{ id: parent.id, name: parent.key }, null],
    ]);
  });

  it("reads the backlog, deletion, restore, a repeated report and a deleted label", async () => {
    const { manager, member, columns, task } = await setup();
    const label = await createLabel(member, "OPA", { name: "release", colour: "red" });
    const labelled = await updateTask(member, "OPA-1", {
      labelIds: [label.id],
      version: task.version,
    });
    const inBacklog = await moveTask(member, "OPA-1", {
      columnId: null,
      version: labelled.version,
    });
    await moveTask(member, "OPA-1", { columnId: columns[0]?.id ?? "", version: inBacklog.version });
    await deleteTask(manager, "OPA-1");
    await restoreTask(manager, "OPA-1");
    await deleteLabel(manager, label.id);

    const scopes = ["projects:read", "tasks:read", "reports:write"] as const;
    const agent = await createTestAgent({ name: "QA Bot", role: "qa_agent", scopes: [...scopes] });
    const bot = agentActor({ accountId: agent.id, role: "qa_agent", scopes, projectIds: null });
    const report = submitBugReportRequestSchema.parse({ title: "Fails", fingerprint: "f-1" });
    const filed = await fileBugReport(bot, "OPA", report);
    await fileBugReport(bot, "OPA", report);

    const page = await listActivity(member, "OPA-1", { limit: 50 });
    const moves = events(page).filter((item) => item.type === "moved");
    expect(moves.map((item) => [item.oldValue, item.newValue])).toEqual([
      [{ column: { id: columns[0]?.id, name: "To do" } }, { column: null }],
      [{ column: null }, { column: { id: columns[0]?.id, name: "To do" } }],
    ]);
    expect(events(page).map((item) => item.type)).toContain("deleted");
    expect(events(page).map((item) => item.type)).toContain("restored");
    const removed = events(page)
      .filter((item) => item.field === "labels")
      .at(-1);
    expect(removed).toMatchObject({ oldValue: [{ id: label.id, name: "release" }], newValue: [] });

    const bug = await listActivity(member, filed.taskKey, { limit: 50 });
    expect(events(bug).at(-1)).toMatchObject({
      type: "reported_again",
      actor: { id: agent.id, name: "QA Bot", kind: "agent" },
      newValue: { occurrences: 2 },
    });
  });

  it("answers a deleted team and column with no name, and a renamed team by its new name", async () => {
    const { manager, member, task } = await setup();
    const kept = await createTeam(manager, { name: "Frontend" });
    const gone = await createTeam(manager, { name: "Backend" });
    const spare = await createColumn(manager, "OPA", { name: "Spare", category: "todo" });
    const one = await updateTask(member, "OPA-1", {
      assigneeTeamId: kept.id,
      version: task.version,
    });
    const two = await updateTask(member, "OPA-1", {
      assigneeTeamId: gone.id,
      version: one.version,
    });
    const three = await moveTask(member, "OPA-1", { columnId: spare.id, version: two.version });
    const four = await moveTask(member, "OPA-1", {
      columnId: task.columnId ?? "",
      version: three.version,
    });
    await updateTask(member, "OPA-1", { assigneeTeamId: null, version: four.version });
    await renameTeam(manager, kept.id, { name: "Web" });
    await deleteTeam(manager, gone.id);
    await deleteColumn(manager, spare.id);

    const page = await listActivity(member, "OPA-1", { limit: 50 });
    const teams = events(page).filter((item) => item.field === "assigneeTeamId");
    expect(teams.map((item) => [item.oldValue, item.newValue])).toEqual([
      [null, { id: kept.id, name: "Web" }],
      [
        { id: kept.id, name: "Web" },
        { id: gone.id, name: null },
      ],
      [{ id: gone.id, name: null }, null],
    ]);
    const moves = events(page).filter((item) => item.type === "moved");
    expect(moves[0]?.newValue).toEqual({ column: { id: spare.id, name: null } });
    expect(moves[1]?.oldValue).toEqual({ column: { id: spare.id, name: null } });
  });

  it("names an agent that changed the task", async () => {
    const { member, task } = await setup();
    const scopes = ["projects:read", "tasks:read", "tasks:write"] as const;
    const agent = await createTestAgent({
      name: "Planner",
      role: "worker_agent",
      scopes: [...scopes],
    });
    const planner = agentActor({
      accountId: agent.id,
      role: "worker_agent",
      scopes,
      projectIds: null,
    });
    await updateTask(planner, "OPA-1", { priority: "high", version: task.version });

    const page = await listActivity(member, "OPA-1", { limit: 50 });

    expect(change(page, "priority")?.actor).toEqual({
      id: agent.id,
      name: "Planner",
      kind: "agent",
    });
  });

  it("pages items with equal timestamps, and a comment added meanwhile, each once", async () => {
    const { member, memberAccount, task } = await setup();
    const at = "2026-11-24 10:00:00.123456+00";
    const db = getDb();
    for (const value of ["a", "b", "c"]) {
      await db.execute(sql`
        insert into task_events (task_id, actor_account_id, type, field, new_value, created_at)
        values (${task.id}, ${memberAccount.id}, 'field_changed', 'title', ${JSON.stringify(value)}::jsonb, ${at})`);
    }
    for (const body of ["x", "y"]) {
      await db.execute(sql`
        insert into comments (task_id, kind, author_account_id, body, created_at)
        values (${task.id}, 'user', ${memberAccount.id}, ${body}, ${at})`);
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await listActivity(member, "OPA-1", { limit: 2, cursor });
      seen.push(...page.items.map((item) => (item.kind === "comment" ? item.comment.id : item.id)));
      if (pages === 0) await createComment(member, "OPA-1", { body: "Later" });
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor !== undefined);

    // created, three events and two comments at one instant, and the later comment.
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  it("answers 404 for a deleted or unknown task, and 403 outside the caller's reach", async () => {
    const { manager, member, project } = await setup();
    await createTask(member, "OPA", { title: "Second" });
    await deleteTask(manager, "OPA-2");

    expect((await failure(listActivity(member, "OPA-2", { limit: 50 }))).status).toBe(404);
    expect((await failure(listActivity(member, "OPA-99", { limit: 50 }))).status).toBe(404);

    const agent = await createTestAgent({ name: "Elsewhere", projectIds: [] });
    const restricted = agentActor({
      accountId: agent.id,
      role: "qa_agent",
      scopes: ["projects:read", "tasks:read"],
      projectIds: [],
    });
    const blind = agentActor({
      accountId: agent.id,
      role: "qa_agent",
      scopes: ["projects:read"],
      projectIds: [project.id],
    });
    expect(await failure(listActivity(restricted, "OPA-1", { limit: 50 }))).toMatchObject({
      status: 403,
    });
    expect(await failure(listActivity(blind, "OPA-1", { limit: 50 }))).toMatchObject({
      status: 403,
    });
  });
});

describe("links in the activity (WS-134 test 13)", () => {
  it("answers linked and unlinked, and hides a task out of a restricted agent's reach", async () => {
    const { manager, member, project, task } = await setup();
    await createProject(manager, { key: "API", name: "API" });
    const other = await createTask(manager, "API", { title: "Orders" });
    const link = { type: "blocks", direction: "outgoing", taskId: other.key } as const;
    await addTaskLink(member, task.key, link);
    await removeTaskLink(member, task.key, link);

    const reading = { type: "blocks", direction: "outgoing", task: { id: other.id, key: "API-1" } };
    const linked = events(await listActivity(member, task.key, { limit: 50 })).filter(
      (item) => item.type === "linked" || item.type === "unlinked",
    );
    expect(
      linked.map((item) => [item.type, item.oldValue, item.newValue, item.actor?.name]),
    ).toEqual([
      ["linked", null, reading, "Mia"],
      ["unlinked", reading, null, "Mia"],
    ]);

    const agent = await createTestAgent({ scopes: ["tasks:read"], projectIds: [project.id] });
    const restricted = agentActor({
      accountId: agent.id,
      role: "qa_agent",
      scopes: ["tasks:read"],
      projectIds: [project.id],
    });
    const hidden = events(await listActivity(restricted, task.key, { limit: 50 })).filter(
      (item) => item.type === "linked",
    );
    expect(hidden.map((item) => item.newValue)).toEqual([{ ...reading, task: null }]);
  });
});

describe("sprints in the activity (WS-141 test 21)", () => {
  it("names a sprintId value by the sprint's name, and null once the sprint is gone", async () => {
    const { manager, member, task } = await setup();
    await updateProject(manager, "OPA", { sprintsEnabled: true, version: 1 });
    const dates = { startDate: "2026-12-01", endDate: "2026-12-14" };
    const kept = await createSprint(manager, "OPA", { name: "Sprint 1", ...dates });
    const gone = await createSprint(manager, "OPA", { name: "Sprint 2", ...dates });

    const one = await updateTask(member, "OPA-1", { sprintId: gone.id, version: task.version });
    await updateTask(member, "OPA-1", { sprintId: kept.id, version: one.version });
    await deleteSprint(manager, gone.id);
    const page = await listActivity(member, "OPA-1", { limit: 50 });

    const changes = events(page).filter(
      (item) => item.type === "field_changed" && item.field === "sprintId",
    );
    expect(changes.map((item) => [item.oldValue, item.newValue])).toEqual(
      expect.arrayContaining([
        [null, { id: gone.id, name: null }],
        [
          { id: gone.id, name: null },
          { id: kept.id, name: "Sprint 1" },
        ],
      ]) as unknown,
    );
  });
});
