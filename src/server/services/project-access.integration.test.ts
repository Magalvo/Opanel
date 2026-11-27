// The coverage test of WS-073: every exported service function is classified, and every
// project-scoped one refuses a project outside the actor's list (WT-05 decision 7).
import { globSync } from "node:fs";
import path from "node:path";

import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import type { Column } from "@/lib/schemas/columns";
import type { Epic } from "@/lib/schemas/epics";
import type { Label } from "@/lib/schemas/labels";
import { PERMISSIONS } from "@/lib/schemas/permissions";
import type { Project } from "@/lib/schemas/projects";
import type { Sprint } from "@/lib/schemas/sprints";
import type { Task } from "@/lib/schemas/tasks";
import type { Actor, AgentActor } from "@/server/auth/actor";
import { createTestAccount, createTestAgent, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { ApiError } from "@/server/http/errors";

import { listActivity } from "./activity";
import { loadAgentActor } from "./agents";
import { fileBugReport, listBugReports } from "./bug-reports";
import { createColumn, deleteColumn, listColumns, moveColumn, updateColumn } from "./columns";
import { createComment, listComments } from "./comments";
import { createEpic, getEpic, listEpics, updateEpic } from "./epics";
import { createLabel, deleteLabel, listLabels, updateLabel } from "./labels";
import {
  archiveProject,
  claimTaskNumber,
  createProject,
  findProjectRef,
  getProject,
  listProjects,
  lockWritableProject,
  unarchiveProject,
  updateProject,
} from "./projects";
import { createSprint, deleteSprint, getSprint, listSprints, updateSprint } from "./sprints";
import { addTaskLink, removeTaskLink } from "./task-links";
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
import { getTriage, updateTriage } from "./triage";

const SERVICES_ROOT = path.join(process.cwd(), "src/server/services");
const UNKNOWN = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";

/** One project and something of each kind inside it, built through the services. */
interface Fixture {
  project: Project;
  /** An extra, empty column: it can be renamed, moved and deleted. */
  spare: Column;
  task: Task;
  deletedTask: Task;
  epic: Epic;
  label: Label;
  sprint: Sprint;
}

type ScopedCall = (actor: Actor, target: Fixture) => Promise<unknown>;

/**
 * Every service function that acts inside a project, with a call that reaches the target
 * project through it (WS-073 section 3). Adding a project-scoped service function means
 * adding it here; a work-spec decides its class.
 */
const PROJECT_SCOPED: Record<string, ScopedCall> = {
  "projects.lockWritableProject": (actor, f) =>
    getDb().transaction((tx) => lockWritableProject(tx, actor, f.project.id)),
  "projects.findProjectRef": (actor, f) => findProjectRef(getDb(), actor, f.project.key),
  "projects.claimTaskNumber": (actor, f) =>
    getDb().transaction((tx) => claimTaskNumber(tx, actor, f.project.key)),
  "projects.getProject": (actor, f) => getProject(actor, f.project.key),
  "projects.updateProject": (actor, f) =>
    updateProject(actor, f.project.id, { name: "Renamed", version: f.project.version }),
  "projects.archiveProject": (actor, f) => archiveProject(actor, f.project.id),
  "projects.unarchiveProject": (actor, f) => unarchiveProject(actor, f.project.id),
  "columns.listColumns": (actor, f) => listColumns(actor, f.project.key),
  "columns.createColumn": (actor, f) =>
    createColumn(actor, f.project.key, { name: "New", category: "todo" }),
  "columns.updateColumn": (actor, f) =>
    updateColumn(actor, f.spare.id, { name: "Renamed", version: f.spare.version }),
  "columns.moveColumn": (actor, f) =>
    moveColumn(actor, f.spare.id, { afterColumnId: null, version: f.spare.version }),
  "columns.deleteColumn": (actor, f) => deleteColumn(actor, f.spare.id),
  "tasks.getTask": (actor, f) => getTask(actor, f.task.key),
  "tasks.listTasks": (actor, f) => listTasks(actor, f.project.key, { limit: 50 }),
  "tasks.listBacklog": (actor, f) => listBacklog(actor, f.project.key, { limit: 50 }),
  "tasks.createTask": (actor, f) => createTask(actor, f.project.key, { title: "New" }),
  "tasks.updateTask": (actor, f) =>
    updateTask(actor, f.task.id, { title: "Renamed", version: f.task.version }),
  "tasks.moveTask": (actor, f) =>
    moveTask(actor, f.task.id, { columnId: f.spare.id, version: f.task.version }),
  "tasks.deleteTask": (actor, f) => deleteTask(actor, f.task.key),
  "tasks.restoreTask": (actor, f) => restoreTask(actor, f.deletedTask.id),
  "epics.listEpics": (actor, f) => listEpics(actor, f.project.key, { limit: 50 }),
  "epics.getEpic": (actor, f) => getEpic(actor, f.epic.id),
  "epics.createEpic": (actor, f) => createEpic(actor, f.project.key, { title: "New" }),
  "epics.updateEpic": (actor, f) =>
    updateEpic(actor, f.epic.id, { title: "Renamed", version: f.epic.version }),
  "labels.listLabels": (actor, f) => listLabels(actor, f.project.key),
  "labels.createLabel": (actor, f) =>
    createLabel(actor, f.project.key, { name: "New", colour: "gray" }),
  "labels.updateLabel": (actor, f) =>
    updateLabel(actor, f.label.id, { name: "Renamed", version: f.label.version }),
  "labels.deleteLabel": (actor, f) => deleteLabel(actor, f.label.id),
  "sprints.listSprints": (actor, f) => listSprints(actor, f.project.key, { limit: 50 }),
  "sprints.getSprint": (actor, f) => getSprint(actor, f.sprint.id),
  "sprints.createSprint": (actor, f) =>
    createSprint(actor, f.project.key, {
      name: "New",
      startDate: "2026-12-01",
      endDate: "2026-12-14",
    }),
  "sprints.updateSprint": (actor, f) =>
    updateSprint(actor, f.sprint.id, { name: "Renamed", version: f.sprint.version }),
  "sprints.deleteSprint": (actor, f) => deleteSprint(actor, f.sprint.id),
  "activity.listActivity": (actor, f) => listActivity(actor, f.task.key, { limit: 50 }),
  "comments.listComments": (actor, f) => listComments(actor, f.task.key, { limit: 50 }),
  "comments.createComment": (actor, f) => createComment(actor, f.task.id, { body: "Hello" }),
  "bug-reports.fileBugReport": (actor, f) =>
    fileBugReport(actor, f.project.key, {
      title: "Crash",
      fingerprint: "fp",
      originLayer: "unknown",
      severity: "medium",
    }),
  "bug-reports.listBugReports": (actor, f) => listBugReports(actor, f.task.key, { limit: 10 }),
  // A link to itself: the reach is checked before the other task (WS-134).
  "task-links.addTaskLink": (actor, f) =>
    addTaskLink(actor, f.task.key, { type: "blocks", direction: "outgoing", taskId: f.task.key }),
  "task-links.removeTaskLink": (actor, f) =>
    removeTaskLink(actor, f.task.key, {
      type: "blocks",
      direction: "outgoing",
      taskId: f.task.key,
    }),
  "triage.getTriage": (actor, f) => getTriage(actor, f.project.key),
  "triage.updateTriage": (actor, f) =>
    updateTriage(actor, f.project.id, { triageTeamId: null, version: f.project.version }),
};

/** Lists that span projects: they leave out what the actor cannot reach (section 4). */
const PROJECT_FILTERED = ["projects.listProjects", "tasks.listAllTasks"];

/** Every other exported function, with the reason it is not project-scoped. */
const NOT_PROJECT_SCOPED: Record<string, string> = {
  "accept-link.acceptLink": "accounts: accepting a one-time link",
  "account-management.listAccounts": "accounts",
  "account-management.inviteAccount": "accounts",
  "account-management.updateAccount": "accounts",
  "account-management.issueResetLink": "accounts",
  "account-management.OperatorRefusal": "an error class",
  "account-management.issueOperatorResetLink": "accounts, from the operator command",
  "account-management.revokeInvitation": "accounts",
  "account-tokens.lockAccount": "accounts: internal",
  "account-tokens.hashToken": "accounts: internal",
  "account-tokens.issueLink": "accounts: internal",
  "accounts.findAccountByEmail": "accounts: internal",
  "accounts.findAccountById": "accounts: internal",
  "accounts.touchLastSeen": "accounts: internal",
  "agents.loadAgentActor": "builds the actor that carries the restriction",
  "agents.listAgents": "agents: Admin only (agents:manage), WS-075",
  "agents.getAgent": "agents: Admin only (agents:manage), WS-075",
  "agents.createAgent": "agents: Admin only (agents:manage); its projectIds are a setting",
  "agents.updateAgent": "agents: Admin only (agents:manage); its projectIds are a setting",
  "agents.listApiTokens": "agents: Admin only (agents:manage), WS-075",
  "agents.createApiToken": "agents: Admin only (agents:manage), WS-075",
  "agents.revokeApiToken": "agents: Admin only (agents:manage), WS-075",
  "audit.recordAudit": "internal: called by a service that has checked",
  "bug-report-description.codeSpan": "pure: renders text",
  "bug-report-description.fenced": "pure: renders text",
  "bug-report-description.renderBugDescription": "pure: renders text",
  "bug-reports.placeNewBug": "internal: called by fileBugReport, which has checked",
  "bug-reports.routeBugReport": "internal: called by fileBugReport, which has checked",
  "comments.addSystemComment": "internal: called by a service that has checked",
  "comments.readComments": "internal: called by listActivity, which has checked",
  "event-hub.createEventHub": "infrastructure: the events stream checks (section 6)",
  "event-hub.getEventHub": "infrastructure: the events stream checks (section 6)",
  "event-hub.closeEventHub": "infrastructure: the events stream checks (section 6)",
  "events.publishEvent": "internal: called by a service that has checked",
  "events.publishEvents": "internal: called by a service that has checked",
  "projects.publishProjectChanged": "internal: called by a service that has checked",
  "health.checkHealth": "public health check",
  "maintenance.runMaintenance": "operator command",
  "people.isPerson": "people are not project-scoped",
  "people.toPerson": "people are not project-scoped",
  "people.listPeople": "people are not project-scoped",
  "profile.renameSelf": "the caller's own account",
  "profile.changeOwnPassword": "the caller's own account",
  "projects.createProject": "no project yet; needs projects:manage, which no agent holds",
  "rate-limit.consumeRateLimit": "infrastructure",
  "rate-limit.purgeExpiredRateLimits": "infrastructure",
  "rate-limit.signInKeys": "infrastructure",
  "setup.isSetupNeeded": "first-run setup",
  "setup.setupGuard": "first-run setup",
  "setup.createFirstAdmin": "first-run setup",
  "sign-in.signInAfterCommit": "sign-in",
  "sign-in.summarize": "sign-in",
  "sign-in.signIn": "sign-in",
  "sign-in.signOut": "sign-in",
  "projects.reachableBy": "internal: the condition the project-filtered lists use",
  "task-events.recordTaskEvent": "internal: called by a service that has checked",
  "sprint-placement.lockFirstColumn": "internal: called by a task write that has checked",
  "sprint-placement.lockSprintContext": "internal: called by a task write that has checked",
  "sprint-placement.placeFor": "internal: called by a task write that has checked (WS-141)",
  "sprint-placement.recordPlaceChange": "internal: called by a service that has checked",
  "sprint-placement.sprintsEnabled": "internal: called by a service that has checked",
  "sprint-placement.unscheduleSprintTasks": "internal: called by deleteSprint, which has checked",
  "task-filter.taskFilterWhere":
    "internal: called by listTasks and listBacklog, which have checked",
  "tasks.findLiveTask": "internal: returns the task's project, which its callers check",
  "tasks.answerTask": "internal: called by addTaskLink, which has checked (WS-134)",
  "tasks.matchesTask": "internal: a SQL condition on a task reference",
  "task-links.insertLink": "internal: called by addTaskLink and fileBugReport, which have checked",
  "teams.listTeams": "teams are not project-scoped",
  "teams.getTeam": "teams are not project-scoped",
  "teams.createTeam": "teams are not project-scoped",
  "teams.renameTeam": "teams are not project-scoped",
  "teams.deleteTeam": "teams are not project-scoped",
  "teams.addTeamMember": "teams are not project-scoped",
  "teams.removeTeamMember": "teams are not project-scoped",
};

/** Every exported function of every service module, as "module.export". */
async function exportedServiceFunctions(): Promise<string[]> {
  const files = globSync("*.ts", { cwd: SERVICES_ROOT }).filter(
    (file) => !file.endsWith(".test.ts") && !file.endsWith("-testing.ts"),
  );
  const names: string[] = [];
  for (const file of files) {
    const exports = z
      .record(z.string(), z.unknown())
      .parse(await import(path.join(SERVICES_ROOT, file)));
    const moduleName = path.basename(file, ".ts");
    for (const [name, value] of Object.entries(exports)) {
      if (typeof value === "function") names.push(`${moduleName}.${name}`);
    }
  }
  return names.sort();
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

/** Everything a project-scoped call could write, as one value per table. */
async function fingerprint(): Promise<Record<string, string>> {
  const tables = [
    "projects",
    "columns",
    "tasks",
    "epics",
    "comments",
    "task_events",
    "audit_log",
    "labels",
    "task_labels",
    "sprints",
  ];
  const result: Record<string, string> = {};
  for (const table of tables) {
    const [row] = await getDb().execute<{ digest: string }>(
      sql`select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) as digest
          from ${sql.identifier(table)} t`,
    );
    result[table] = row?.digest ?? "";
  }
  return result;
}

async function buildFixture(admin: Actor, key: string): Promise<Fixture> {
  await createProject(admin, { key, name: `Project ${key}` });
  const project = await updateProject(admin, key, { sprintsEnabled: true, version: 1 });
  const spare = await createColumn(admin, key, { name: "Spare", category: "todo" });
  const task = await createTask(admin, key, { title: "A task" });
  const deletedTask = await createTask(admin, key, { title: "A deleted task" });
  await deleteTask(admin, deletedTask.id);
  const epic = await createEpic(admin, key, { title: "An epic" });
  await createComment(admin, task.id, { body: "A comment" });
  const label = await createLabel(admin, key, { name: "A label", colour: "red" });
  const sprint = await createSprint(admin, key, {
    name: "A sprint",
    startDate: "2026-12-01",
    endDate: "2026-12-14",
  });
  return { project, spare, task, deletedTask, epic, label, sprint };
}

let admin: Actor;
let a: Fixture;
let b: Fixture;
/** Holds every permission of the catalogue, restricted to project A (section 5). */
let restricted: AgentActor;

beforeEach(async () => {
  admin = testActor(
    await createTestAccount({ name: "Admin", email: "admin@example.com", role: "admin" }),
  );
  a = await buildFixture(admin, "AAA");
  b = await buildFixture(admin, "BBB");
  const agent = await createTestAgent({ name: "Restricted" });
  restricted = {
    kind: "agent",
    accountId: agent.id,
    role: "worker_agent",
    permissions: new Set(PERMISSIONS),
    projectIds: new Set([a.project.id]),
  };
});

describe("every exported service function is classified (WS-073)", () => {
  it("is in exactly one of the reviewed lists, and no entry is stale", async () => {
    const exported = await exportedServiceFunctions();
    const classified = [
      ...Object.keys(PROJECT_SCOPED),
      ...PROJECT_FILTERED,
      ...Object.keys(NOT_PROJECT_SCOPED),
    ];

    expect(
      exported.filter((name) => !classified.includes(name)),
      "Unclassified service functions: a work-spec decides whether each is project-scoped",
    ).toEqual([]);
    expect(
      classified.filter((name) => !exported.includes(name)),
      "Classified functions that no longer exist",
    ).toEqual([]);
    expect(new Set(classified).size, "A function is in more than one list").toBe(classified.length);
  });
});

describe.each(Object.entries(PROJECT_SCOPED))("%s (WS-073)", (_name, call) => {
  it("refuses another project with 403 and writes nothing", async () => {
    const before = await fingerprint();

    const error = await failure(call(restricted, b));

    expect(error).toMatchObject({ status: 403, code: "forbidden" });
    expect(await fingerprint()).toEqual(before);
  });

  it("refuses another project with 403 even when it is archived", async () => {
    await archiveProject(admin, b.project.id);
    const before = await fingerprint();

    const error = await failure(call(restricted, b));

    expect(error).toMatchObject({ status: 403, code: "forbidden" });
    expect(await fingerprint()).toEqual(before);
  });

  it("does not refuse a project in the actor's list", async () => {
    await call(restricted, a).catch((error: unknown) => {
      // Only the restriction is under test: any other outcome is the function's own.
      if (error instanceof ApiError && error.code === "forbidden") throw error;
    });
  });
});

describe("the order of refusals (WS-073 section 3)", () => {
  it("answers 404 for unknown ids, as for anyone", async () => {
    const unknownIds = [
      () => getProject(restricted, UNKNOWN),
      () => getProject(restricted, "ZZZ"),
      () => getTask(restricted, UNKNOWN),
      () => getTask(restricted, "ZZZ-1"),
      () => updateColumn(restricted, UNKNOWN, { name: "X", version: 1 }),
      () => getEpic(restricted, UNKNOWN),
      () => getSprint(restricted, UNKNOWN),
      () => listComments(restricted, UNKNOWN, { limit: 50 }),
      () => listActivity(restricted, UNKNOWN, { limit: 50 }),
    ];
    for (const call of unknownIds) {
      expect((await failure(call())).status).toBe(404);
    }
  });
});

describe("agents built from their rows (WS-073)", () => {
  async function agentRestrictedTo(projectIds: string[] | null) {
    const account = await createTestAgent({
      name: `Worker ${String(projectIds?.length ?? "all")}`,
      role: "worker_agent",
      scopes: ["projects:read", "tasks:read", "comments:write", "tasks:write"],
      projectIds,
    });
    const loaded = await loadAgentActor(getDb(), account.id);
    if (!loaded) throw new Error("no agent");
    return loaded.actor;
  }

  it("lets a restricted worker agent work in its project and nowhere else", async () => {
    const agent = await agentRestrictedTo([a.project.id]);

    const created = await createTask(agent, "AAA", { title: "By the agent" });
    // Project AAA uses sprints: a move onto the board needs an active sprint (WS-141).
    await getDb().execute(
      sql`update sprints set state = 'active', started_at = now() where id = ${a.sprint.id}`,
    );
    await moveTask(agent, created.id, { columnId: a.spare.id, version: created.version });
    await createComment(agent, created.key, { body: "Done" });
    expect((await listProjects(agent, { limit: 50 })).items.map((p) => p.key)).toEqual(["AAA"]);

    for (const call of [
      () => getTask(agent, b.task.id),
      () => getTask(agent, b.task.key),
      () => createTask(agent, "BBB", { title: "Elsewhere" }),
      () => createTask(agent, b.project.id, { title: "Elsewhere" }),
      () => createComment(agent, b.task.key, { body: "Elsewhere" }),
      () => listTasks(agent, "BBB", { limit: 50 }),
    ]) {
      expect(await failure(call())).toMatchObject({ status: 403, code: "forbidden" });
    }
  });

  it("lets an agent with all projects reach both", async () => {
    const agent = await agentRestrictedTo(null);

    expect((await getTask(agent, a.task.key)).id).toBe(a.task.id);
    expect((await getTask(agent, b.task.key)).id).toBe(b.task.id);
    expect((await listProjects(agent, { limit: 50 })).items.map((p) => p.key)).toEqual([
      "AAA",
      "BBB",
    ]);
  });

  it("leaves humans unchanged", async () => {
    const member = testActor(
      await createTestAccount({ name: "Mia", email: "mia@example.com", role: "member" }),
    );
    const viewer = testActor(
      await createTestAccount({ name: "Vic", email: "vic@example.com", role: "viewer" }),
    );

    await createComment(member, b.task.key, { body: "From a member" });
    expect((await getTask(viewer, b.task.key)).id).toBe(b.task.id);
    expect((await failure(createTask(viewer, "BBB", { title: "No" }))).code).toBe("forbidden");
  });
});
