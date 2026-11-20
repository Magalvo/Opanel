import { sql } from "drizzle-orm";

import { positionBetween } from "@/lib/position";
import type {
  BugReportAnswer,
  OriginLayer,
  SubmitBugReportRequest,
} from "@/lib/schemas/bug-reports";
import { type Actor, requirePermission } from "@/server/auth/actor";
import { type Database, getDb } from "@/server/db/client";
import { notFound, projectArchived } from "@/server/http/errors";

import { recordAudit } from "./audit";
import { codeSpan, renderBugDescription } from "./bug-report-description";
import { addSystemComment } from "./comments";
import { publishEvent } from "./events";
import { claimTaskNumber, findProjectRef, lockWritableProject } from "./projects";
import { recordTaskEvent } from "./task-events";

// The bug report endpoint's service: the triage pipeline of canonical doc 0001 section 6
// (WT-06 decisions 3 and 6 to 14, WS-089 section 3).

type Executor = Pick<Database, "execute" | "insert">;

/** A repeat gets a comment when the previous report is older than this, or from another run. */
const QUIET_PERIOD = sql`interval '1 hour'`;

interface Project {
  id: string;
  key: string;
}

/**
 * The team a new bug goes to (WT-06 decision 3): the layer's rule, else the project's triage
 * team, else none. `unknown` always goes to the triage team.
 */
export async function routeBugReport(
  tx: Executor,
  projectId: string,
  layer: OriginLayer,
): Promise<{ id: string; name: string } | null> {
  const [row] = await tx.execute<{ id: string | null; name: string | null }>(sql`
    select t.id, t.name
    from projects p
    left join routing_rules r
      on r.project_id = p.id and r.origin_layer = ${layer} and ${layer} <> 'unknown'
    left join teams t on t.id = coalesce(r.team_id, p.triage_team_id)
    where p.id = ${projectId}`);
  return row?.id != null && row.name != null ? { id: row.id, name: row.name } : null;
}

/**
 * Where a new bug goes (WT-06 decision 7): the top of the project's first column. Locks that
 * column, as `createTask` does. WT-10 changes only this function for sprint projects.
 */
export async function placeNewBug(
  tx: Executor,
  projectId: string,
): Promise<{ columnId: string; position: string }> {
  const [column] = await tx.execute<{ id: string }>(sql`
    select id from columns where project_id = ${projectId}
    order by position limit 1 for no key update`);
  if (!column) throw new Error("The project has no column.");
  // Deleted tasks keep their place, so they count here too.
  const [first] = await tx.execute<{ position: string }>(sql`
    select position from tasks where column_id = ${column.id} order by position limit 1`);
  return { columnId: column.id, position: positionBetween(null, first?.position ?? null) };
}

function filedSentence(agentName: string, report: SubmitBugReportRequest): string {
  const confidence =
    report.confidence === undefined ? "" : `, confidence ${String(report.confidence)}`;
  return (
    `Filed by ${agentName} from a bug report: layer ${report.originLayer}${confidence}, ` +
    `severity ${report.severity}.`
  );
}

async function agentName(tx: Executor, actor: Actor): Promise<string> {
  const [row] = await tx.execute<{ name: string }>(
    sql`select name from accounts where id = ${actor.accountId}`,
  );
  return row?.name ?? "an agent";
}

/**
 * Files a bug report (WS-089). In one transaction: keeps the report, and either counts it on
 * the open bug with the same fingerprint or creates a new bug. Never holds a shared project
 * lock before claiming a task number, so two reports cannot deadlock (section 3).
 */
export async function fileBugReport(
  actor: Actor,
  projectRef: string,
  report: SubmitBugReportRequest,
  db: Database = getDb(),
): Promise<BugReportAnswer> {
  requirePermission(actor, "reports:write");

  return db.transaction(async (tx) => {
    // 1. Answer early, without a lock: 404, 403, 409. The locks below settle any race.
    const project = await findProjectRef(tx, actor, projectRef);
    if (!project) throw notFound("There is no such project.");
    const [state] = await tx.execute<{ archived: boolean }>(
      sql`select archived_at is not null as archived from projects where id = ${project.id}`,
    );
    if (state?.archived) throw projectArchived();

    // 2. Reports with this fingerprint in this project run one at a time (decision 6).
    await tx.execute(sql`
      select pg_advisory_xact_lock(hashtextextended(${project.id} || ':' || ${report.fingerprint}, 0))`);

    // 3. The open task: not deleted, not in a `done` column; the latest reported wins.
    const [open] = await tx.execute<{ id: string; number: number }>(sql`
      select t.id, t.number from tasks t join columns c on c.id = t.column_id
      where t.project_id = ${project.id} and t.fingerprint = ${report.fingerprint}
        and t.deleted_at is null and c.category <> 'done'
      order by t.last_reported_at desc nulls last, t.created_at desc
      limit 1`);

    const name = await agentName(tx, actor);
    const answer =
      open === undefined
        ? await createBug(tx, actor, project, report, name)
        : await countRepeat(tx, actor, project, open, report, name);

    await recordAudit(tx, {
      actor,
      action: "bug_report.triaged",
      entity: "bug_report",
      entityId: answer.reportId,
      data: { taskId: answer.taskId, outcome: answer.outcome, assignedTeamId: answer.teamId },
    });
    return answer.body;
  });
}

interface Outcome {
  body: BugReportAnswer;
  reportId: string;
  taskId: string;
  outcome: "created" | "deduplicated";
  teamId: string | null;
}

async function insertReport(
  tx: Executor,
  actor: Actor,
  projectId: string,
  taskId: string,
  outcome: "created" | "deduplicated",
  report: SubmitBugReportRequest,
): Promise<string> {
  const [row] = await tx.execute<{ id: string }>(sql`
    insert into bug_reports (project_id, agent_account_id, task_id, outcome, origin_layer,
      confidence, severity, fingerprint, run_id, payload)
    values (${projectId}, ${actor.accountId}, ${taskId}, ${outcome}, ${report.originLayer},
      ${report.confidence ?? null}, ${report.severity}, ${report.fingerprint},
      ${report.runId ?? null}, ${JSON.stringify(report)}::jsonb)
    returning id`);
  if (!row) throw new Error("The bug report was not stored.");
  return row.id;
}

async function countRepeat(
  tx: Executor,
  actor: Actor,
  project: Project,
  open: { id: string; number: number },
  report: SubmitBugReportRequest,
  agent: string,
): Promise<Outcome> {
  // As every task edit: the project shared (it re-checks the archive), then the task.
  await lockWritableProject(tx, actor, project.id);
  const [task] = await tx.execute<{ assignee_team_id: string | null }>(sql`
    select assignee_team_id from tasks where id = ${open.id} for update`);
  if (!task) throw new Error("The open bug disappeared under its lock.");

  // Read before the new report is stored (section 5).
  const [quiet] = await tx.execute<{ comment: boolean }>(sql`
    select (created_at < now() - ${QUIET_PERIOD}
      or run_id is distinct from ${report.runId ?? null}) as comment
    from bug_reports where task_id = ${open.id}
    order by created_at desc, id desc limit 1`);

  const [updated] = await tx.execute<{ occurrences: number; version: number }>(sql`
    update tasks set occurrences = occurrences + 1, last_reported_at = now(),
      version = version + 1, updated_at = now()
    where id = ${open.id}
    returning occurrences, version`);
  if (!updated) throw new Error("The open bug was not updated.");

  const reportId = await insertReport(tx, actor, project.id, open.id, "deduplicated", report);
  await recordTaskEvent(tx, {
    taskId: open.id,
    actor,
    type: "reported_again",
    newValue: { reportId, occurrences: updated.occurrences },
  });
  await publishEvent(tx, {
    type: "task.updated",
    entity: "task",
    projectId: project.id,
    entityId: open.id,
    version: updated.version,
    actorAccountId: actor.accountId,
  });
  if (quiet?.comment ?? true) {
    const run = report.runId === undefined ? "" : ` in run ${codeSpan(report.runId)}`;
    await addSystemComment(
      tx,
      actor,
      { id: open.id, projectId: project.id },
      `Reported again by ${agent}${run}. Reported ${String(updated.occurrences)} times.`,
    );
  }

  return {
    body: {
      outcome: "deduplicated",
      taskId: open.id,
      taskKey: `${project.key}-${String(open.number)}`,
      occurrences: updated.occurrences,
    },
    reportId,
    taskId: open.id,
    outcome: "deduplicated",
    teamId: task.assignee_team_id,
  };
}

async function createBug(
  tx: Executor,
  actor: Actor,
  project: Project,
  report: SubmitBugReportRequest,
  agent: string,
): Promise<Outcome> {
  // The exclusive project lock, taken first: it re-checks the archive (section 3).
  const claimed = await claimTaskNumber(tx, actor, project.id);
  const team = await routeBugReport(tx, project.id, report.originLayer);
  const place = await placeNewBug(tx, project.id);
  const [closed] = await tx.execute<{ id: string; number: number }>(sql`
    select t.id, t.number from tasks t join columns c on c.id = t.column_id
    where t.project_id = ${project.id} and t.fingerprint = ${report.fingerprint}
      and t.deleted_at is null and c.category = 'done'
    order by t.updated_at desc, t.id
    limit 1`);

  const [task] = await tx.execute<{ id: string }>(sql`
    insert into tasks (project_id, number, type, title, description, column_id, position,
      assignee_team_id, severity, fingerprint, occurrences, last_reported_at,
      reporter_account_id)
    values (${project.id}, ${claimed.number}, 'bug', ${report.title},
      ${renderBugDescription(report)}, ${place.columnId}, ${place.position}, ${team?.id ?? null},
      ${report.severity}, ${report.fingerprint}, 1, now(), ${actor.accountId})
    returning id`);
  if (!task) throw new Error("The bug was not created.");

  const key = `${project.key}-${String(claimed.number)}`;
  const reportId = await insertReport(tx, actor, project.id, task.id, "created", report);
  await recordTaskEvent(tx, {
    taskId: task.id,
    actor,
    type: "created",
    newValue: {
      key,
      type: "bug",
      title: report.title,
      columnId: place.columnId,
      severity: report.severity,
      reportId,
    },
  });
  if (closed) {
    await tx.execute(sql`
      insert into task_links (from_task_id, to_task_id, type, created_by)
      values (${task.id}, ${closed.id}, 'regression_of', ${actor.accountId})`);
  }

  await publishEvent(tx, {
    type: "task.created",
    entity: "task",
    projectId: project.id,
    entityId: task.id,
    version: 1,
    actorAccountId: actor.accountId,
  });

  const sentences = [filedSentence(agent, report)];
  sentences.push(
    team === null
      ? `No team owns the ${report.originLayer} layer in this project, and it has no triage ` +
          "team: triage this bug by hand."
      : `Assigned to ${team.name}.`,
  );
  if (closed) sentences.push(`Regression of ${project.key}-${String(closed.number)}.`);
  await addSystemComment(tx, actor, { id: task.id, projectId: project.id }, sentences.join(" "));

  return {
    body: { outcome: "created", taskId: task.id, taskKey: key, assignedTeamId: team?.id ?? null },
    reportId,
    taskId: task.id,
    outcome: "created",
    teamId: team?.id ?? null,
  };
}
