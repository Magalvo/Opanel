import { sql } from "drizzle-orm";

import type {
  CompletedSprint,
  CompleteSprintRequest,
  CreateSprintRequest,
  Sprint,
  SprintPage,
  SprintQuery,
  SprintState,
  StartSprintRequest,
  UpdateSprintRequest,
} from "@/lib/schemas/sprints";
import { type Actor, requirePermission, requireProjectAccess } from "@/server/auth/actor";
import { type Database, getDb } from "@/server/db/client";
import { sprints } from "@/server/db/schema";
import {
  invalidRequest,
  notFound,
  sprintActive,
  sprintCompleted,
  sprintNotActive,
  sprintNotPlanned,
  sprintsDisabled,
  versionConflict,
} from "@/server/http/errors";
import { decodeSprintCursor, encodeSprintCursor } from "@/server/http/pagination";

import { recordAudit } from "./audit";
import { publishEvent } from "./events";
import { findProjectRef, lockWritableProject } from "./projects";
import {
  lockFirstColumn,
  placeCompletedSprintTasks,
  placeStartedSprintTasks,
  unscheduleSprintTasks,
} from "./sprint-placement";

// Sprints in the API (WS-140): planned sprints are created, edited and deleted here; item D
// starts and completes them (WS-142).

type Executor = Pick<Database, "execute">;

const ISO_MS = sql`'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;

/**
 * A sprint's live tasks and points, sub-tasks included, done meaning in a `done` column
 * (WT-10 decision 2), summed as an epic's (WS-139). Refers to the sprint as `s`.
 */
const LIVE_PROGRESS = sql`
  select count(*)::int as total_tasks,
    (count(*) filter (where c.category = 'done'))::int as done_tasks,
    coalesce(sum(t.story_points), 0)::float8 as total_points,
    coalesce(sum(t.story_points) filter (where c.category = 'done'), 0)::float8 as done_points,
    (count(*) filter (where t.story_points is null))::int as unestimated
  from tasks t left join columns c on c.id = t.column_id
  where t.sprint_id = s.id and t.deleted_at is null`;

/** Every column of a sprint's API shape, and its creation time with microseconds (cursor). */
const SPRINT_SELECT = sql`
  select s.id, s.project_id, s.name, s.goal, s.state, s.version,
    to_char(s.start_date, 'YYYY-MM-DD') as start_date,
    to_char(s.end_date, 'YYYY-MM-DD') as end_date,
    to_char(s.started_at at time zone 'utc', ${ISO_MS}) as started_at,
    to_char(s.completed_at at time zone 'utc', ${ISO_MS}) as completed_at,
    to_char(s.created_at at time zone 'utc', ${ISO_MS}) as created_at,
    to_char(s.updated_at at time zone 'utc', ${ISO_MS}) as updated_at,
    to_char(s.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at_us,
    -- Progress (WS-142 section 3): frozen once completed, else over the live tasks.
    case when s.state = 'completed' then s.total_tasks else sp.total_tasks end as total_tasks,
    case when s.state = 'completed' then s.completed_tasks else sp.done_tasks end as done_tasks,
    case when s.state = 'completed' then s.total_points::float8 else sp.total_points end
      as total_points,
    case when s.state = 'completed' then s.completed_points::float8 else sp.done_points end
      as done_points,
    case when s.state = 'completed' then s.unestimated else sp.unestimated end as unestimated
  from sprints s
  cross join lateral (${LIVE_PROGRESS} and s.state <> 'completed') sp`;

interface SprintRow extends Record<string, unknown> {
  id: string;
  project_id: string;
  name: string;
  goal: string;
  state: SprintState;
  version: number;
  start_date: string;
  end_date: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  created_at_us: string;
  total_tasks: number;
  done_tasks: number;
  total_points: number;
  done_points: number;
  unestimated: number;
}

function toSprint(row: SprintRow): Sprint {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    goal: row.goal,
    startDate: row.start_date,
    endDate: row.end_date,
    state: row.state,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    progress: {
      doneTasks: row.done_tasks,
      totalTasks: row.total_tasks,
      donePoints: row.done_points,
      totalPoints: row.total_points,
      unestimated: row.unestimated,
    },
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sprintNotFound() {
  return notFound("There is no such sprint.");
}

function datesOutOfOrder() {
  return invalidRequest(
    [{ path: "endDate", message: "The end date may not be before the start date." }],
    "The request body is not valid.",
  );
}

async function findSprint(executor: Executor, sprintId: string): Promise<SprintRow | undefined> {
  const [row] = await executor.execute<SprintRow>(sql`${SPRINT_SELECT} where s.id = ${sprintId}`);
  return row;
}

export async function listSprints(
  actor: Actor,
  projectRef: string,
  query: SprintQuery,
  db: Database = getDb(),
): Promise<SprintPage> {
  requirePermission(actor, "tasks:read");
  const project = await findProjectRef(db, actor, projectRef);
  if (!project) throw notFound("There is no such project.");

  const ofState =
    query.state === undefined
      ? sql``
      : sql`and s.state in (${sql.join(
          query.state.map((state) => sql`${state}`),
          sql`, `,
        )})`;
  const after =
    query.cursor === undefined
      ? sql``
      : (() => {
          const cursor = decodeSprintCursor(query.cursor);
          return sql`and (s.start_date, s.created_at, s.id) >
            (${cursor.startDate}::date, ${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`;
        })();

  const rows = await db.execute<SprintRow>(sql`
    ${SPRINT_SELECT}
    where s.project_id = ${project.id} ${ofState} ${after}
    order by s.start_date, s.created_at, s.id
    limit ${query.limit + 1}`);

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(toSprint),
    nextCursor:
      rows.length > query.limit && last
        ? encodeSprintCursor({
            startDate: last.start_date,
            createdAt: last.created_at_us,
            id: last.id,
          })
        : null,
  };
}

export async function getSprint(
  actor: Actor,
  sprintId: string,
  db: Database = getDb(),
): Promise<Sprint> {
  requirePermission(actor, "tasks:read");
  const row = await findSprint(db, sprintId);
  if (!row) throw sprintNotFound();
  requireProjectAccess(actor, row.project_id);
  return toSprint(row);
}

/** Announces a change to a sprint: its version after the write, `null` when deleted. */
async function publishSprintChanged(
  executor: Executor,
  actor: Actor,
  sprint: { id: string; project_id: string },
  version: number | null,
): Promise<void> {
  await publishEvent(executor, {
    type: "sprint.changed",
    entity: "sprint",
    projectId: sprint.project_id,
    entityId: sprint.id,
    version,
    actorAccountId: actor.accountId,
  });
}

async function requireSprintsEnabled(executor: Executor, projectId: string): Promise<void> {
  const [project] = await executor.execute<{ sprints_enabled: boolean }>(
    sql`select sprints_enabled from projects where id = ${projectId}`,
  );
  if (!project?.sprints_enabled) throw sprintsDisabled();
}

/**
 * For a write to one sprint: resolves its project and locks it as `lockWritableProject`
 * does (`404`, `403`, `409 project_archived`), then locks the sprint's row. Starting and
 * completing (WS-142) take the project exclusively, as tasks leave or join the backlog;
 * starting locks the first column, and completing the target sprint, in id order with it.
 */
async function lockSprint(
  executor: Executor,
  actor: Actor,
  sprintId: string,
  options: { exclusive?: boolean; firstColumn?: boolean; also?: string | null } = {},
): Promise<SprintRow> {
  const [owner] = await executor.execute<{ project_id: string }>(
    sql`select project_id from sprints where id = ${sprintId}`,
  );
  if (!owner) throw sprintNotFound();
  await lockWritableProject(
    executor,
    actor,
    owner.project_id,
    options.exclusive === true ? "exclusive" : "shared",
  );
  if (options.firstColumn === true) await lockFirstColumn(executor, owner.project_id);
  const ids = [sprintId, ...(options.also ? [options.also] : [])];
  await executor.execute(sql`
    select 1 from sprints
    where project_id = ${owner.project_id} and id in (${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
    order by id for update`);
  const sprint = await findSprint(executor, sprintId);
  if (!sprint) throw sprintNotFound();
  return sprint;
}

export async function createSprint(
  actor: Actor,
  projectRef: string,
  input: CreateSprintRequest,
  db: Database = getDb(),
): Promise<Sprint> {
  requirePermission(actor, "sprints:manage");
  if (input.endDate < input.startDate) throw datesOutOfOrder();

  return db.transaction(async (tx) => {
    const project = await lockWritableProject(tx, actor, projectRef);
    await requireSprintsEnabled(tx, project.id);
    const [row] = await tx
      .insert(sprints)
      .values({
        projectId: project.id,
        name: input.name,
        goal: input.goal ?? "",
        startDate: input.startDate,
        endDate: input.endDate,
        createdBy: actor.accountId,
      })
      .returning({ id: sprints.id });
    if (!row) throw sprintNotFound();

    await recordAudit(tx, {
      actor,
      action: "sprint.created",
      entity: "sprint",
      entityId: row.id,
      data: { projectId: project.id, name: input.name },
    });

    const created = await findSprint(tx, row.id);
    if (!created) throw sprintNotFound();
    await publishSprintChanged(tx, actor, created, created.version);
    return toSprint(created);
  });
}

/** The fields whose change writes `sprint.updated`, in the order they are listed. */
const EDITABLE = [
  ["name", "name"],
  ["goal", "goal"],
  ["startDate", "start_date"],
  ["endDate", "end_date"],
] as const;

export async function updateSprint(
  actor: Actor,
  sprintId: string,
  input: UpdateSprintRequest,
  db: Database = getDb(),
): Promise<Sprint> {
  requirePermission(actor, "sprints:manage");

  return db.transaction(async (tx) => {
    const before = await lockSprint(tx, actor, sprintId);
    if (before.version !== input.version) throw versionConflict(toSprint(before));
    if (before.state === "completed") throw sprintCompleted();
    await requireSprintsEnabled(tx, before.project_id);

    const after = {
      name: input.name ?? before.name,
      goal: input.goal ?? before.goal,
      startDate: input.startDate ?? before.start_date,
      endDate: input.endDate ?? before.end_date,
    };
    // The pair is checked as it will be, which a request alone cannot see (as for epics).
    if (after.endDate < after.startDate) throw datesOutOfOrder();

    await tx.execute(sql`
      update sprints set name = ${after.name}, goal = ${after.goal},
        start_date = ${after.startDate}, end_date = ${after.endDate},
        version = version + 1, updated_at = now()
      where id = ${sprintId}`);

    const changed = EDITABLE.filter(([field, column]) => after[field] !== before[column]).map(
      ([field]) => field,
    );
    if (changed.length > 0) {
      await recordAudit(tx, {
        actor,
        action: "sprint.updated",
        entity: "sprint",
        entityId: sprintId,
        data: { projectId: before.project_id, changed },
      });
    }

    const updated = await findSprint(tx, sprintId);
    if (!updated) throw sprintNotFound();
    await publishSprintChanged(tx, actor, updated, updated.version);
    return toSprint(updated);
  });
}

/**
 * Deletes a planned sprint, also while the project does not use sprints (WS-140 question 4).
 * No `version` is asked, as for labels. Its tasks become unscheduled first (WS-141).
 */
export async function deleteSprint(
  actor: Actor,
  sprintId: string,
  db: Database = getDb(),
): Promise<void> {
  requirePermission(actor, "sprints:manage");

  await db.transaction(async (tx) => {
    const sprint = await lockSprint(tx, actor, sprintId);
    if (sprint.state !== "planned") throw sprintNotPlanned();

    await unscheduleSprintTasks(tx, actor, sprint.project_id, sprintId);
    await tx.execute(sql`delete from sprints where id = ${sprintId}`);
    await recordAudit(tx, {
      actor,
      action: "sprint.deleted",
      entity: "sprint",
      entityId: sprintId,
      data: { projectId: sprint.project_id, name: sprint.name },
    });
    await publishSprintChanged(tx, actor, sprint, null);
  });
}

/**
 * Starts a planned sprint (WS-142 section 4): it becomes active and its live tasks go to the
 * bottom of the first column, in backlog order. One sprint is active at a time. Its dates do
 * not change.
 */
export async function startSprint(
  actor: Actor,
  sprintId: string,
  input: StartSprintRequest,
  db: Database = getDb(),
): Promise<Sprint> {
  requirePermission(actor, "sprints:manage");

  return db.transaction(async (tx) => {
    const before = await lockSprint(tx, actor, sprintId, { exclusive: true, firstColumn: true });
    await requireSprintsEnabled(tx, before.project_id);
    if (before.state !== "planned") {
      throw sprintNotPlanned("Only a planned sprint can be started.");
    }
    const [active] = await tx.execute(sql`
      select 1 from sprints where project_id = ${before.project_id} and state = 'active'`);
    if (active) throw sprintActive("Another sprint is active in this project. Complete it first.");
    if (before.version !== input.version) throw versionConflict(toSprint(before));

    await tx.execute(sql`
      update sprints set state = 'active', started_at = now(), version = version + 1,
        updated_at = now()
      where id = ${sprintId}`);
    const tasks = await placeStartedSprintTasks(tx, actor, before.project_id, sprintId);
    await recordAudit(tx, {
      actor,
      action: "sprint.started",
      entity: "sprint",
      entityId: sprintId,
      data: { projectId: before.project_id, name: before.name, tasks },
    });

    const started = await findSprint(tx, sprintId);
    if (!started) throw sprintNotFound();
    await publishSprintChanged(tx, actor, started, started.version);
    return toSprint(started);
  });
}

function badTarget() {
  return invalidRequest(
    [{ path: "moveUnfinishedTo", message: "Not a planned sprint of this project." }],
    "The request body is not valid.",
  );
}

/**
 * Completes the active sprint (WS-142 section 5): its progress is frozen, done families stay
 * as its record and the others go to `moveUnfinishedTo` (a planned sprint) or unscheduled, at
 * the top of the backlog. Answers the sprint and the unfinished sub-tasks its record kept.
 */
export async function completeSprint(
  actor: Actor,
  sprintId: string,
  input: CompleteSprintRequest,
  db: Database = getDb(),
): Promise<CompletedSprint> {
  requirePermission(actor, "sprints:manage");
  const target = input.moveUnfinishedTo;

  return db.transaction(async (tx) => {
    const before = await lockSprint(tx, actor, sprintId, { exclusive: true, also: target });
    await requireSprintsEnabled(tx, before.project_id);
    if (before.state !== "active") throw sprintNotActive();
    if (target !== null) {
      const [planned] = await tx.execute<{ state: SprintState }>(sql`
        select state from sprints where id = ${target} and project_id = ${before.project_id}`);
      if (planned?.state !== "planned") throw badTarget();
    }
    if (before.version !== input.version) throw versionConflict(toSprint(before));

    // Frozen before anything moves (WS-142 section 3).
    await tx.execute(sql`
      update sprints set state = 'completed', completed_at = now(),
        version = version + 1, updated_at = now(),
        total_tasks = ${before.total_tasks}, completed_tasks = ${before.done_tasks},
        total_points = ${before.total_points}, completed_points = ${before.done_points},
        unestimated = ${before.unestimated}
      where id = ${sprintId}`);
    const placed = await placeCompletedSprintTasks(tx, actor, before.project_id, sprintId, target);
    await recordAudit(tx, {
      actor,
      action: "sprint.completed",
      entity: "sprint",
      entityId: sprintId,
      data: {
        projectId: before.project_id,
        name: before.name,
        moveUnfinishedTo: target,
        moved: placed.moved,
      },
    });

    const completed = await findSprint(tx, sprintId);
    if (!completed) throw sprintNotFound();
    await publishSprintChanged(tx, actor, completed, completed.version);
    if (target !== null) {
      const next = await findSprint(tx, target);
      if (next) await publishSprintChanged(tx, actor, next, next.version);
    }
    return { ...toSprint(completed), unfinishedSubtasksKept: placed.unfinishedSubtasksKept };
  });
}
