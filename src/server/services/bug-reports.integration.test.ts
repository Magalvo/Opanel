import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { submitBugReportRequestSchema } from "@/lib/schemas/bug-reports";
import type { AgentScope } from "@/lib/schemas/permissions";
import { agentActor } from "@/server/auth/actor";
import { createTestAccount, createTestAgent, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { auditLog, bugReports, comments, taskEvents, taskLinks, tasks } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

import { fileBugReport, listBugReports } from "./bug-reports";
import { listColumns } from "./columns";
import { type EventListener, listenForEvents } from "./events-testing";
import { archiveProject, createProject } from "./projects";
import { createTask, deleteTask, getTask, moveTask, updateTask } from "./tasks";
import { createTeam } from "./teams";
import { updateTriage } from "./triage";

// The bug report endpoint's service: the triage pipeline (WS-089).

let listener: EventListener | undefined;

afterEach(async () => {
  await listener?.close();
  listener = undefined;
});

async function setup(options: { scopes?: AgentScope[] } = {}) {
  const manager = await createTestAccount({
    name: "Manager",
    email: "manager@example.com",
    role: "manager",
  });
  const managerActor = testActor(manager);
  const project = await createProject(managerActor, { key: "OPA", name: "Opanel" });
  const columns = (await listColumns(managerActor, "OPA")).items;
  const scopes = options.scopes ?? ["projects:read", "tasks:read", "reports:write"];
  const agent = await createTestAgent({ name: "QA Bot", role: "qa_agent", scopes });
  const bot = agentActor({ accountId: agent.id, role: "qa_agent", scopes, projectIds: null });
  return { manager, managerActor, project, columns, agent, bot };
}

function report(extra: Record<string, unknown> = {}) {
  return submitBugReportRequestSchema.parse({
    title: "Checkout returns 500",
    fingerprint: "api:/orders:500",
    originLayer: "api",
    confidence: 0.8,
    severity: "high",
    summary: "The Pay button fails.",
    runId: "run-1",
    ...extra,
  });
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

async function commentsOf(taskId: string) {
  return getDb()
    .select()
    .from(comments)
    .where(eq(comments.taskId, taskId))
    .orderBy(comments.createdAt, comments.id);
}

async function historyOf(taskId: string) {
  return getDb()
    .select()
    .from(taskEvents)
    .where(eq(taskEvents.taskId, taskId))
    .orderBy(taskEvents.id);
}

async function triageTeams(managerActor: ReturnType<typeof testActor>, version: number) {
  const frontend = await createTeam(managerActor, { name: "Frontend" });
  const api = await createTeam(managerActor, { name: "API" });
  const triage = await createTeam(managerActor, { name: "Triage" });
  await updateTriage(managerActor, "OPA", {
    triageTeamId: triage.id,
    rules: { frontend: frontend.id, api: api.id },
    version,
  });
  return { frontend, api, triage };
}

describe("fileBugReport: a new bug (WS-089)", () => {
  it("creates a bug at the top of the first column, assigned to the layer's team", async () => {
    const { managerActor, project, columns, agent, bot } = await setup();
    const { api } = await triageTeams(managerActor, project.version);
    await createTask(managerActor, "OPA", { title: "Already there" });
    listener = await listenForEvents();

    const answer = await fileBugReport(bot, "OPA", report());

    expect(answer).toEqual({
      outcome: "created",
      taskId: expect.any(String) as unknown,
      taskKey: "OPA-2",
      assignedTeamId: api.id,
    });
    const task = await getTask(managerActor, "OPA-2");
    expect(task).toMatchObject({
      type: "bug",
      title: "Checkout returns 500",
      severity: "high",
      fingerprint: "api:/orders:500",
      occurrences: 1,
      columnId: columns[0]?.id,
      assigneeTeam: { id: api.id, name: "API" },
      assignee: null,
      reporter: { id: agent.id, name: "QA Bot", kind: "agent" },
      version: 1,
    });
    expect(task.lastReportedAt).not.toBeNull();
    expect(task.description).toContain("### Summary");
    const [top] = await getDb()
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.columnId, columns[0]?.id ?? ""))
      .orderBy(tasks.position)
      .limit(1);
    expect(top?.id).toBe(task.id);

    const [stored] = await getDb().select().from(bugReports);
    expect(stored).toMatchObject({
      projectId: project.id,
      agentAccountId: agent.id,
      taskId: task.id,
      outcome: "created",
      originLayer: "api",
      severity: "high",
      fingerprint: "api:/orders:500",
      runId: "run-1",
      payload: report(),
    });
    expect(stored?.confidence).toBeCloseTo(0.8);

    const history = await historyOf(task.id);
    expect(history.map((event) => [event.type, event.actorAccountId])).toEqual([
      ["created", agent.id],
      ["commented", agent.id],
    ]);
    expect(history[0]?.newValue).toMatchObject({
      key: "OPA-2",
      type: "bug",
      severity: "high",
      reportId: stored?.id,
    });

    const [comment] = await commentsOf(task.id);
    expect(comment).toMatchObject({ kind: "system", authorAccountId: null });
    expect(comment?.body).toBe(
      "Filed by QA Bot from a bug report: layer api, confidence 0.8, severity high. " +
        "Assigned to API.",
    );

    const audit = await getDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "bug_report.triaged"));
    expect(audit).toEqual([
      expect.objectContaining({
        actorAccountId: agent.id,
        entity: "bug_report",
        entityId: stored?.id,
        data: { taskId: task.id, outcome: "created", assignedTeamId: api.id },
      }),
    ]);

    await listener.settle();
    const events = listener.events().filter((event) => event.projectId === project.id);
    expect(events.map((event) => [event.type, event.actorAccountId])).toEqual(
      expect.arrayContaining([
        ["task.created", agent.id],
        ["comment.created", agent.id],
      ]),
    );
  });

  it("routes unknown and a layer without a rule to the triage team, and says when no team owns it", async () => {
    const { managerActor, project, bot } = await setup();

    const nobody = await fileBugReport(bot, "OPA", report({ fingerprint: "a" }));
    expect(nobody).toMatchObject({ outcome: "created", assignedTeamId: null });
    const [lonely] = await commentsOf(nobody.taskId);
    expect(lonely?.body).toBe(
      "Filed by QA Bot from a bug report: layer api, confidence 0.8, severity high. " +
        "No team owns the api layer in this project, and it has no triage team: triage this " +
        "bug by hand.",
    );

    const { frontend, triage } = await triageTeams(managerActor, project.version);
    await updateTriage(managerActor, "OPA", { rules: { api: null }, version: project.version + 1 });

    const byRule = await fileBugReport(
      bot,
      "OPA",
      report({ fingerprint: "b", originLayer: "frontend" }),
    );
    const noRule = await fileBugReport(
      bot,
      "OPA",
      report({ fingerprint: "c", originLayer: "api" }),
    );
    const unknown = await fileBugReport(
      bot,
      "OPA",
      report({ fingerprint: "d", originLayer: "unknown", confidence: undefined }),
    );

    expect(byRule).toMatchObject({ assignedTeamId: frontend.id });
    expect(noRule).toMatchObject({ assignedTeamId: triage.id });
    expect(unknown).toMatchObject({ assignedTeamId: triage.id });
    const [unknownComment] = await commentsOf(unknown.taskId);
    expect(unknownComment?.body).toBe(
      "Filed by QA Bot from a bug report: layer unknown, severity high. Assigned to Triage.",
    );
  });

  it("links a new bug to the most recently updated closed bug, and never to a deleted one", async () => {
    const { managerActor, columns, agent, bot } = await setup();
    const done = columns[2]?.id ?? "";
    const older = await fileBugReport(bot, "OPA", report());
    await moveTask(managerActor, older.taskKey, { columnId: done, version: 1 });
    const newer = await fileBugReport(bot, "OPA", report());
    expect(newer.outcome).toBe("created");
    await moveTask(managerActor, newer.taskKey, { columnId: done, version: 1 });
    // A deleted open bug of the same fingerprint is not counted on.
    const deleted = await fileBugReport(bot, "OPA", report());
    await deleteTask(managerActor, deleted.taskKey);

    const regression = await fileBugReport(bot, "OPA", report());

    // OPA-1 and OPA-2 are closed, OPA-2 more recently; OPA-3 (open) is deleted.
    expect(regression).toMatchObject({ outcome: "created", taskKey: "OPA-4" });
    const links = await getDb()
      .select()
      .from(taskLinks)
      .where(eq(taskLinks.fromTaskId, regression.taskId));
    expect(links).toEqual([
      expect.objectContaining({
        toTaskId: newer.taskId,
        type: "regression_of",
        createdBy: agent.id,
      }),
    ]);
    const [comment] = await commentsOf(regression.taskId);
    expect(comment?.body).toMatch(/ Regression of OPA-2\.$/);
  });
});

describe("fileBugReport: a repeat (WS-089)", () => {
  it("counts on the open bug and changes nothing a person set", async () => {
    const { manager, managerActor, project, columns, agent, bot } = await setup();
    const { frontend } = await triageTeams(managerActor, project.version);
    const first = await fileBugReport(bot, "OPA", report());
    await updateTask(managerActor, first.taskKey, {
      assigneeTeamId: frontend.id,
      assigneeAccountId: manager.id,
      severity: "low",
      version: 1,
    });
    await moveTask(managerActor, first.taskKey, { columnId: columns[1]?.id ?? "", version: 2 });
    const before = await getTask(managerActor, first.taskKey);
    listener = await listenForEvents();

    const answer = await fileBugReport(bot, "OPA", report());

    expect(answer).toEqual({
      outcome: "deduplicated",
      taskId: first.taskId,
      taskKey: "OPA-1",
      occurrences: 2,
    });
    const after = await getTask(managerActor, first.taskKey);
    expect(after).toMatchObject({
      occurrences: 2,
      version: before.version + 1,
      columnId: columns[1]?.id,
      assigneeTeam: { id: frontend.id },
      assignee: { id: manager.id },
      severity: "low",
    });
    expect(after.lastReportedAt).not.toBe(before.lastReportedAt);
    expect(await getDb().select({ id: tasks.id }).from(tasks)).toHaveLength(1);
    const stored = await getDb().select().from(bugReports).orderBy(bugReports.createdAt);
    expect(stored.map((row) => [row.outcome, row.taskId])).toEqual([
      ["created", first.taskId],
      ["deduplicated", first.taskId],
    ]);
    const repeat = (await historyOf(first.taskId)).find((event) => event.type === "reported_again");
    expect(repeat).toMatchObject({
      actorAccountId: agent.id,
      newValue: { reportId: stored[1]?.id, occurrences: 2 },
    });
    await listener.settle();
    expect(
      listener
        .events()
        .filter((event) => event.projectId === project.id)
        .map((event) => event.type),
    ).toEqual(["task.updated"]);
  });

  it("comments on a repeat only after an hour or from another run", async () => {
    const { bot } = await setup();
    const first = await fileBugReport(bot, "OPA", report());

    await fileBugReport(bot, "OPA", report());
    expect(await commentsOf(first.taskId)).toHaveLength(1);

    await fileBugReport(bot, "OPA", report({ runId: "run-2" }));
    const [, otherRun] = await commentsOf(first.taskId);
    expect(otherRun?.body).toBe("Reported again by QA Bot in run ` run-2 `. Reported 3 times.");

    await fileBugReport(bot, "OPA", report({ runId: undefined }));
    expect(await commentsOf(first.taskId)).toHaveLength(3);

    await getDb().execute(sql`alter table bug_reports disable trigger user`);
    await getDb().execute(sql`update bug_reports set created_at = created_at - interval '2 hours'`);
    await getDb().execute(sql`alter table bug_reports enable trigger user`);
    await fileBugReport(bot, "OPA", report({ runId: undefined }));
    const all = await commentsOf(first.taskId);
    expect(all).toHaveLength(4);
    expect(all[3]?.body).toBe("Reported again by QA Bot. Reported 5 times.");
  });

  it("serialises ten identical reports into one task, and creates ten tasks for ten fingerprints", async () => {
    const { bot } = await setup();

    const same = await Promise.all(
      Array.from({ length: 10 }, () => fileBugReport(bot, "OPA", report())),
    );
    const different = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        fileBugReport(bot, "OPA", report({ fingerprint: `fp-${String(index)}` })),
      ),
    );

    expect(same.filter((answer) => answer.outcome === "created")).toHaveLength(1);
    expect(new Set(same.map((answer) => answer.taskId)).size).toBe(1);
    const [counted] = await getDb()
      .select({ occurrences: tasks.occurrences })
      .from(tasks)
      .where(eq(tasks.fingerprint, "api:/orders:500"));
    expect(counted?.occurrences).toBe(10);
    expect(different.every((answer) => answer.outcome === "created")).toBe(true);
    expect(new Set(different.map((answer) => answer.taskKey)).size).toBe(10);
    expect(await getDb().select({ id: bugReports.id }).from(bugReports)).toHaveLength(20);
  });
});

describe("fileBugReport: who may file (WS-089)", () => {
  it("refuses people, agents without reports:write or outside their projects, and archived or unknown projects", async () => {
    const { managerActor } = await setup();
    const admin = testActor(
      await createTestAccount({ name: "Admin", email: "admin@example.com", role: "admin" }),
    );
    const reader = await createTestAgent({
      name: "Reader",
      role: "qa_agent",
      scopes: ["tasks:read"],
    });
    const other = await createProject(managerActor, { key: "WEB", name: "Web" });
    const restricted = await createTestAgent({
      name: "Restricted",
      role: "qa_agent",
      scopes: ["reports:write"],
      projectIds: [other.id],
    });
    const statuses = await Promise.all(
      [
        fileBugReport(admin, "OPA", report()),
        fileBugReport(
          agentActor({
            accountId: reader.id,
            role: "qa_agent",
            scopes: ["tasks:read"],
            projectIds: null,
          }),
          "OPA",
          report(),
        ),
        fileBugReport(
          agentActor({
            accountId: restricted.id,
            role: "qa_agent",
            scopes: ["reports:write"],
            projectIds: [other.id],
          }),
          "OPA",
          report(),
        ),
      ].map((promise) => failure(promise).then((error) => error.status)),
    );
    expect(statuses).toEqual([403, 403, 403]);

    const filer = agentActor({
      accountId: restricted.id,
      role: "qa_agent",
      scopes: ["reports:write"],
      projectIds: null,
    });
    expect((await failure(fileBugReport(filer, "NOPE", report()))).status).toBe(404);
    await archiveProject(managerActor, "OPA");
    const archived = await failure(fileBugReport(filer, "OPA", report()));
    expect([archived.status, archived.code]).toEqual([409, "project_archived"]);
    expect(await getDb().select({ id: bugReports.id }).from(bugReports)).toHaveLength(0);
  });
});

describe("listBugReports (WS-090)", () => {
  it("reads the reports behind a task newest first, each as sent", async () => {
    const { managerActor, agent, bot } = await setup();
    const full = report({
      evidence: {
        stepsToReproduce: ["Open /checkout", "Click Pay"],
        http: { method: "POST", path: "/api/orders", status: 500, responseSnippet: "{}" },
        diagnosis: "The API throws.",
      },
    });
    const first = await fileBugReport(bot, "OPA", full);
    const minimal = submitBugReportRequestSchema.parse({
      title: "Checkout returns 500",
      fingerprint: "api:/orders:500",
    });
    await fileBugReport(bot, "OPA", minimal);

    const page = await listBugReports(managerActor, first.taskKey, { limit: 10 });

    expect(page.nextCursor).toBeNull();
    expect(page.items).toEqual([
      {
        id: expect.any(String) as unknown,
        taskId: first.taskId,
        agent: { id: agent.id, name: "QA Bot", kind: "agent" },
        outcome: "deduplicated",
        originLayer: "unknown",
        confidence: null,
        severity: "medium",
        fingerprint: "api:/orders:500",
        runId: null,
        title: "Checkout returns 500",
        summary: null,
        evidence: null,
        createdAt: expect.any(String) as unknown,
      },
      {
        id: expect.any(String) as unknown,
        taskId: first.taskId,
        agent: { id: agent.id, name: "QA Bot", kind: "agent" },
        outcome: "created",
        originLayer: "api",
        confidence: 0.8,
        severity: "high",
        fingerprint: "api:/orders:500",
        runId: "run-1",
        title: "Checkout returns 500",
        summary: "The Pay button fails.",
        evidence: full.evidence,
        createdAt: expect.any(String) as unknown,
      },
    ]);
  });

  it("answers an empty page, and 404 for an unknown or deleted task", async () => {
    const { managerActor, bot } = await setup();
    const plain = await createTask(managerActor, "OPA", { title: "Plain" });
    const filed = await fileBugReport(bot, "OPA", report());
    await deleteTask(managerActor, filed.taskKey);

    expect(await listBugReports(managerActor, plain.key, { limit: 10 })).toEqual({
      items: [],
      nextCursor: null,
    });
    for (const ref of ["OPA-99", filed.taskKey]) {
      expect((await failure(listBugReports(managerActor, ref, { limit: 10 }))).status).toBe(404);
    }
  });

  it("pages through reports that share a creation time without repeating or skipping one", async () => {
    const { managerActor, bot } = await setup();
    const first = await fileBugReport(bot, "OPA", report());
    for (let index = 0; index < 11; index += 1) await fileBugReport(bot, "OPA", report());
    await getDb().execute(sql`alter table bug_reports disable trigger user`);
    await getDb().execute(sql`update bug_reports set created_at = '2026-11-20T08:00:00.123456Z'`);
    await getDb().execute(sql`alter table bug_reports enable trigger user`);

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listBugReports(managerActor, first.taskKey, {
        limit: 5,
        ...(cursor === undefined ? {} : { cursor }),
      });
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);

    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
    expect(seen).toEqual([...seen].sort().reverse());
  });
});
