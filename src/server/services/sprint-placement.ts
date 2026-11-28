import { sql } from "drizzle-orm";

import { positionBetween, positionsBetween } from "@/lib/position";
import type { SprintState } from "@/lib/schemas/sprints";
import type { Actor } from "@/server/auth/actor";
import type { Database } from "@/server/db/client";
import { taskEvents } from "@/server/db/schema";
import {
  invalidRequest,
  noActiveSprint,
  sprintCompleted,
  sprintsDisabled,
  subtaskFollowsParent,
} from "@/server/http/errors";

import { recordAudit } from "./audit";
import { type ProjectEventInput, publishEvent, publishEvents } from "./events";

// Where a task goes (WT-10 decision 5, WS-141 section 3): every write that changes a task's
// column or sprint asks `placeFor`. In a project with sprints, a live task has a column
// exactly while its sprint is active or completed; without sprints, today's places hold.
//
// Lock order of a task write: the project (shared, or exclusive when the backlog's order
// may change), the columns, the active sprint (`for share`), then the task. Starting and
// completing a sprint (WS-142) lock the project exclusively, the first column (start), the
// sprints `for update`, then the sprint's tasks, so they run one at a time with these writes.

type Executor = Pick<Database, "execute">;

/** What a write knows of the project's sprints, with the active sprint locked. */
export interface SprintContext {
  projectId: string;
  enabled: boolean;
  activeSprintId: string | null;
}

/** A task as placement sees it: its sprint, its place, and its parent's sprint. */
export interface PlacedTask {
  sprintId: string | null;
  sprintState: SprintState | null;
  columnId: string | null;
  /** `null` for a task being created. */
  position: string | null;
  /** Set on sub-tasks only. */
  parent?: { sprintId: string | null; sprintState: SprintState | null } | undefined;
}

/**
 * What a write asks for: a column (a move onto the board, or a creation in a column), the
 * backlog (a move, with the planned sprint it names), a sprint (`sprintId` on a write, or a
 * sub-task following its parent with `follow`), or the place it has (a restore).
 */
export type Wanted =
  | { kind: "column"; columnId: string }
  | { kind: "backlog"; sprintId?: string | null | undefined }
  | { kind: "sprint"; sprintId: string | null; follow?: boolean }
  | { kind: "stay" };

/**
 * The task's sprint and place after the write. `position` undefined: the task goes into
 * `columnId` (or the backlog) where the write says, which the caller works out.
 */
export interface Placement {
  sprintId: string | null;
  columnId: string | null;
  position: string | undefined;
}

const SUBTASK_SPRINT = "A sub-task's sprint is its parent's.";

function sprintError(message: string) {
  return invalidRequest([{ path: "sprintId", message }], "The request body is not valid.");
}

/** Whether the project uses sprints. The caller holds the project's lock. */
export async function sprintsEnabled(executor: Executor, projectId: string): Promise<boolean> {
  const [project] = await executor.execute<{ sprints_enabled: boolean }>(
    sql`select sprints_enabled from projects where id = ${projectId}`,
  );
  return project?.sprints_enabled === true;
}

/** Reads the project's active sprint `for share` (see the lock order above). */
export async function lockSprintContext(
  executor: Executor,
  projectId: string,
  enabled: boolean,
): Promise<SprintContext> {
  if (!enabled) return { projectId, enabled, activeSprintId: null };
  const [active] = await executor.execute<{ id: string }>(sql`
    select id from sprints where project_id = ${projectId} and state = 'active' for share`);
  return { projectId, enabled, activeSprintId: active?.id ?? null };
}

/** Locks the project's first column, where a task joining the active sprint goes. */
export async function lockFirstColumn(executor: Executor, projectId: string): Promise<void> {
  await executor.execute(sql`
    select id from columns where project_id = ${projectId}
    order by position limit 1 for no key update`);
}

/** A sprint of the project's state, else `400` on `sprintId`. */
async function stateOf(executor: Executor, projectId: string, sprintId: string) {
  const [sprint] = await executor.execute<{ state: SprintState }>(
    sql`select state from sprints where id = ${sprintId} and project_id = ${projectId}`,
  );
  if (!sprint) throw sprintError("Not a sprint of this project.");
  return sprint.state;
}

/** The bottom of the first column; deleted tasks keep their place, so they count. */
async function firstColumnEnd(executor: Executor, projectId: string) {
  const [column] = await executor.execute<{ id: string }>(sql`
    select id from columns where project_id = ${projectId}
    order by position limit 1 for no key update`);
  if (!column) throw new Error("The project has no column.");
  const [last] = await executor.execute<{ position: string }>(sql`
    select position from tasks where column_id = ${column.id} order by position desc limit 1`);
  return { columnId: column.id, position: positionBetween(last?.position ?? null, null) };
}

/** The end of the backlog. The caller holds the project's exclusive lock (WS-101). */
async function backlogEnd(executor: Executor, projectId: string): Promise<string> {
  const [last] = await executor.execute<{ position: string }>(sql`
    select position from tasks where project_id = ${projectId} and column_id is null
    order by position desc limit 1`);
  return positionBetween(last?.position ?? null, null);
}

function onBoard(state: SprintState | null): boolean {
  return state === "active" || state === "completed";
}

function kept(task: PlacedTask, sprintId: string | null): Placement {
  return { sprintId, columnId: task.columnId, position: task.position ?? undefined };
}

/**
 * The rule of WT-10 decision 5 (WS-141 section 3): the task's sprint, column and position
 * after a write asking for `wanted`, or a refusal.
 */
export async function placeFor(
  executor: Executor,
  context: SprintContext,
  task: PlacedTask,
  wanted: Wanted,
): Promise<Placement> {
  return context.enabled
    ? placeWithSprints(executor, context, task, wanted)
    : placeWithoutSprints(executor, context, task, wanted);
}

/** Today's places; a column clears a planned sprint kept from before (question 3). */
async function placeWithoutSprints(
  executor: Executor,
  context: SprintContext,
  task: PlacedTask,
  wanted: Wanted,
): Promise<Placement> {
  switch (wanted.kind) {
    case "column":
      return {
        sprintId: task.sprintState === "planned" ? null : task.sprintId,
        columnId: wanted.columnId,
        position: undefined,
      };
    case "backlog":
      if (typeof wanted.sprintId === "string") throw sprintsDisabled();
      return {
        sprintId: wanted.sprintId === null ? null : task.sprintId,
        columnId: null,
        position: undefined,
      };
    case "sprint": {
      if (wanted.sprintId !== null && wanted.follow !== true) throw sprintsDisabled();
      if (wanted.follow !== true && task.parent && wanted.sprintId !== task.parent.sprintId) {
        throw sprintError(SUBTASK_SPRINT);
      }
      const planned =
        wanted.sprintId !== null &&
        (await stateOf(executor, context.projectId, wanted.sprintId)) === "planned";
      return kept(task, planned && task.columnId !== null ? null : wanted.sprintId);
    }
    case "stay":
      return kept(task, task.sprintId);
  }
}

async function placeWithSprints(
  executor: Executor,
  context: SprintContext,
  task: PlacedTask,
  wanted: Wanted,
): Promise<Placement> {
  const active = context.activeSprintId;
  switch (wanted.kind) {
    case "column":
      if (active === null) throw noActiveSprint();
      if (task.parent && task.parent.sprintId !== active) throw subtaskFollowsParent();
      return { sprintId: active, columnId: wanted.columnId, position: undefined };

    case "backlog": {
      if (task.parent) {
        // A sub-task is off the board exactly when its parent is.
        if (onBoard(task.parent.sprintState)) throw subtaskFollowsParent();
        if (wanted.sprintId !== undefined && wanted.sprintId !== task.parent.sprintId) {
          throw sprintError(SUBTASK_SPRINT);
        }
        return { sprintId: task.parent.sprintId, columnId: null, position: undefined };
      }
      if (wanted.sprintId === undefined) {
        // A backlog task keeps its planned sprint; one leaving a column is unscheduled.
        const keep = task.columnId === null && task.sprintState === "planned";
        return { sprintId: keep ? task.sprintId : null, columnId: null, position: undefined };
      }
      if (
        wanted.sprintId !== null &&
        (await stateOf(executor, context.projectId, wanted.sprintId)) !== "planned"
      ) {
        throw sprintError("Not a planned sprint.");
      }
      return { sprintId: wanted.sprintId, columnId: null, position: undefined };
    }

    case "sprint": {
      const target = wanted.sprintId;
      if (wanted.follow !== true) {
        if (task.sprintState === "completed" && target !== task.sprintId) throw sprintCompleted();
        if (task.parent && target !== task.parent.sprintId) throw sprintError(SUBTASK_SPRINT);
      }
      // A task of a sprint that has just started has no column yet: it goes on the board.
      const joining = task.sprintState === "active" && task.columnId === null;
      if (target === task.sprintId && task.position !== null && !joining) {
        return kept(task, target);
      }
      const state = target === null ? null : await stateOf(executor, context.projectId, target);
      if (state === "completed") throw sprintError("Not a planned or active sprint.");
      if (state === "active") {
        if (task.columnId !== null && task.position !== null) return kept(task, target);
        return { sprintId: target, ...(await firstColumnEnd(executor, context.projectId)) };
      }
      if (task.columnId === null && task.position !== null) return kept(task, target);
      return {
        sprintId: target,
        columnId: null,
        position: await backlogEnd(executor, context.projectId),
      };
    }

    case "stay":
      if (task.columnId !== null && !onBoard(task.sprintState)) {
        return {
          sprintId: null,
          columnId: null,
          position: await backlogEnd(executor, context.projectId),
        };
      }
      if (task.columnId === null && onBoard(task.sprintState)) return kept(task, null);
      return kept(task, task.sprintId);
  }
}

/** Records a write's `moved` and `field_changed` on `sprintId` entries, in the order given. */
export async function recordPlaceChange(
  executor: Executor & Pick<Database, "insert">,
  actor: Actor,
  taskId: string,
  before: { columnId: string | null; sprintId: string | null },
  after: { columnId: string | null; sprintId: string | null },
  movedFirst: boolean,
): Promise<void> {
  await recordPlaceChanges(executor, actor, [{ taskId, before, after }], movedFirst);
}

/**
 * Makes a planned sprint's tasks unscheduled before it is deleted (WS-141 section 8): live
 * ones get a new version, a history entry and `task.updated`; they have no column, so they
 * keep their backlog rank. Deleted ones only lose the sprint.
 */
export async function unscheduleSprintTasks(
  executor: Executor & Pick<Database, "insert">,
  actor: Actor,
  projectId: string,
  sprintId: string,
): Promise<void> {
  const context = await lockSprintContext(
    executor,
    projectId,
    await sprintsEnabled(executor, projectId),
  );
  const live = await executor.execute<{
    id: string;
    column_id: string | null;
    position: string;
    state: SprintState;
  }>(sql`
    select t.id, t.column_id, t.position, s.state from tasks t join sprints s on s.id = t.sprint_id
    where t.sprint_id = ${sprintId} and t.deleted_at is null
    order by t.position collate "C", t.id
    for update of t`);
  const events = [];
  for (const task of live) {
    const placed = await placeFor(
      executor,
      context,
      {
        sprintId,
        sprintState: task.state,
        columnId: task.column_id,
        position: task.position,
      },
      { kind: "sprint", sprintId: null, follow: true },
    );
    const [row] = await executor.execute<{ version: number }>(sql`
      update tasks set sprint_id = ${placed.sprintId}, column_id = ${placed.columnId},
        position = ${placed.position ?? task.position}, version = version + 1, updated_at = now()
      where id = ${task.id}
      returning version`);
    await recordPlaceChange(
      executor,
      actor,
      task.id,
      { columnId: task.column_id, sprintId },
      { columnId: placed.columnId, sprintId: placed.sprintId },
      false,
    );
    events.push({
      type:
        placed.columnId === task.column_id ? ("task.updated" as const) : ("task.moved" as const),
      entity: "task" as const,
      projectId,
      entityId: task.id,
      version: row?.version ?? 0,
      actorAccountId: actor.accountId,
    });
  }
  await executor.execute(sql`
    update tasks set sprint_id = null where sprint_id = ${sprintId} and deleted_at is not null`);
  await publishEvents(executor, events);
}

function movedOrUpdated(
  before: string | null,
  after: string | null,
): "task.moved" | "task.updated" {
  return before === after ? "task.updated" : "task.moved";
}

/** A task's place before and after a write that moves many tasks at once (WS-142). */
interface PlaceChange {
  taskId: string;
  before: { columnId: string | null; sprintId: string | null };
  after: { columnId: string | null; sprintId: string | null; position: string };
}

/**
 * Writes many tasks' new places in one statement, each with a new version (unless `silent`,
 * for deleted tasks), and answers each live task's version after the write.
 */
async function writePlaces(
  executor: Executor,
  changes: readonly PlaceChange[],
  silent = false,
): Promise<Map<string, number>> {
  if (changes.length === 0) return new Map();
  const values = JSON.stringify(
    changes.map((change) => ({
      id: change.taskId,
      sprint_id: change.after.sprintId,
      column_id: change.after.columnId,
      position: change.after.position,
    })),
  );
  const bump = silent ? sql`` : sql`, version = t.version + 1, updated_at = now()`;
  const rows = await executor.execute<{ id: string; version: number }>(sql`
    update tasks t set sprint_id = v.sprint_id, column_id = v.column_id, position = v.position
      ${bump}
    from jsonb_to_recordset(${values}::jsonb)
      as v(id uuid, sprint_id uuid, column_id uuid, position text)
    where t.id = v.id
    returning t.id, t.version`);
  return new Map(rows.map((row) => [row.id, row.version]));
}

/** Records the `moved` and `field_changed` on `sprintId` entries of many tasks in one insert. */
async function recordPlaceChanges(
  executor: Pick<Database, "insert">,
  actor: Actor,
  changes: readonly {
    taskId: string;
    before: PlaceChange["before"];
    after: { columnId: string | null; sprintId: string | null };
  }[],
  movedFirst: boolean,
): Promise<void> {
  const entries = changes.flatMap(({ taskId, before, after }) => {
    const moved =
      before.columnId === after.columnId
        ? []
        : [
            {
              taskId,
              actorAccountId: actor.accountId,
              type: "moved",
              field: null,
              oldValue: { columnId: before.columnId },
              newValue: { columnId: after.columnId },
            },
          ];
    const sprint =
      before.sprintId === after.sprintId
        ? []
        : [
            {
              taskId,
              actorAccountId: actor.accountId,
              type: "field_changed",
              field: "sprintId",
              oldValue: before.sprintId,
              newValue: after.sprintId,
            },
          ];
    return movedFirst ? [...moved, ...sprint] : [...sprint, ...moved];
  });
  if (entries.length > 0) await executor.insert(taskEvents).values(entries);
}

/** Writes the places, their history and their events (`task.moved` when the column changes). */
async function applyPlaces(
  executor: Executor & Pick<Database, "insert">,
  actor: Actor,
  projectId: string,
  changes: readonly PlaceChange[],
  movedFirst: boolean,
): Promise<ProjectEventInput[]> {
  const versions = await writePlaces(executor, changes);
  await recordPlaceChanges(executor, actor, changes, movedFirst);
  return changes.map(({ taskId, before, after }) => ({
    type: movedOrUpdated(before.columnId, after.columnId),
    entity: "task",
    projectId,
    entityId: taskId,
    version: versions.get(taskId) ?? 0,
    actorAccountId: actor.accountId,
  }));
}

/**
 * Puts a just-started sprint's live tasks on the board (WS-142 section 4): the rule's
 * active-sprint branch places the first at the bottom of the first column and the others
 * follow it, in backlog order, each with a new version, a `moved` entry and `task.moved`. The
 * sprint is already `active`; the caller holds the project exclusively, the first column and
 * the sprint. Returns how many.
 */
export async function placeStartedSprintTasks(
  executor: Executor & Pick<Database, "insert">,
  actor: Actor,
  projectId: string,
  sprintId: string,
): Promise<number> {
  const live = await executor.execute<{ id: string; column_id: string | null; position: string }>(
    sql`
    select id, column_id, position from tasks
    where sprint_id = ${sprintId} and deleted_at is null
    order by position collate "C", id
    for update`,
  );
  const [first] = live;
  if (!first) return 0;

  const context: SprintContext = { projectId, enabled: true, activeSprintId: sprintId };
  const place = await placeFor(
    executor,
    context,
    { sprintId, sprintState: "active", columnId: first.column_id, position: first.position },
    { kind: "sprint", sprintId, follow: true },
  );
  const start = place.position ?? first.position;
  const positions = [start, ...positionsBetween(start, null, live.length - 1)];
  const changes = live.map((task, index) => ({
    taskId: task.id,
    before: { columnId: task.column_id, sprintId },
    after: {
      columnId: place.columnId,
      sprintId: place.sprintId,
      position: positions[index] ?? task.position,
    },
  }));
  await publishEvents(executor, await applyPlaces(executor, actor, projectId, changes, true));
  return live.length;
}

interface SprintTaskRow extends Record<string, unknown> {
  id: string;
  parent_task_id: string | null;
  column_id: string | null;
  position: string;
  deleted: boolean;
  done: boolean;
}

/**
 * Sends a completed sprint's unfinished work away (WS-142 section 5). Tasks go by family: a
 * task with no parent in the sprint, with its sub-tasks. A family whose head is in a `done`
 * column stays as the record, unfinished sub-tasks included; every other family leaves for
 * `target` (a planned sprint, or `null`) at the top of the backlog, families in board order,
 * each head before its sub-tasks. Live tasks that leave get their entries and events; deleted
 * ones follow the same split silently. The caller holds the project exclusively and the
 * sprints, and has frozen the progress.
 */
export async function placeCompletedSprintTasks(
  executor: Executor & Pick<Database, "insert">,
  actor: Actor,
  projectId: string,
  sprintId: string,
  target: string | null,
): Promise<{ moved: number; unfinishedSubtasksKept: number }> {
  const rows = await executor.execute<SprintTaskRow>(sql`
    select t.id, t.parent_task_id, t.column_id, t.position,
      t.deleted_at is not null as deleted, coalesce(c.category = 'done', false) as done
    from tasks t left join columns c on c.id = t.column_id
    where t.sprint_id = ${sprintId}
    order by c.position collate "C" nulls last, t.position collate "C", t.id
    for update of t`);

  const byId = new Map(rows.map((row) => [row.id, row]));
  // A live sub-task's parent is live (WT-09 decision 5); a deleted one's may be either.
  const headOf = (row: SprintTaskRow): SprintTaskRow => {
    const parent = row.parent_task_id === null ? undefined : byId.get(row.parent_task_id);
    return parent && (row.deleted || !parent.deleted) ? parent : row;
  };
  const leaves = (row: SprintTaskRow) => !headOf(row).done;

  const members = new Map<string, SprintTaskRow[]>();
  for (const row of rows) {
    const head = headOf(row);
    if (!row.deleted && head !== row) members.set(head.id, [...(members.get(head.id) ?? []), row]);
  }
  const leaving: SprintTaskRow[] = [];
  for (const row of rows) {
    if (row.deleted || headOf(row) !== row || !leaves(row)) continue;
    leaving.push(row, ...(members.get(row.id) ?? []));
  }
  const unfinishedSubtasksKept = rows.filter(
    (row) => !row.deleted && headOf(row) !== row && !leaves(row) && !row.done,
  ).length;
  const deletedLeaving = rows.filter((row) => row.deleted && leaves(row));
  const deletedPlaced = deletedLeaving.filter((row) => row.column_id !== null);

  const [top] = await executor.execute<{ position: string }>(sql`
    select position from tasks where project_id = ${projectId} and column_id is null
    order by position collate "C" limit 1`);
  const keys = positionsBetween(null, top?.position ?? null, leaving.length + deletedPlaced.length);

  // The rule decides the place of a head and of a sub-task following it; every family
  // leaving goes to the same place, so each is asked once.
  const context: SprintContext = { projectId, enabled: true, activeSprintId: null };
  const targetState: SprintState | null = target === null ? null : "planned";
  const places = new Map<boolean, Placement>();
  const placeOf = async (row: SprintTaskRow): Promise<Placement> => {
    const isHead = headOf(row) === row;
    const known = places.get(isHead);
    if (known) return known;
    const placed = await placeFor(
      executor,
      context,
      {
        sprintId,
        sprintState: "completed",
        columnId: row.column_id,
        position: row.position,
        parent: isHead ? undefined : { sprintId: target, sprintState: targetState },
      },
      { kind: "backlog", sprintId: target },
    );
    places.set(isHead, placed);
    return placed;
  };

  const changes: PlaceChange[] = [];
  for (const [index, row] of leaving.entries()) {
    const placed = await placeOf(row);
    changes.push({
      taskId: row.id,
      before: { columnId: row.column_id, sprintId },
      after: {
        columnId: placed.columnId,
        sprintId: placed.sprintId,
        position: keys[index] ?? row.position,
      },
    });
  }
  const events = await applyPlaces(executor, actor, projectId, changes, true);
  // A head's sub-tasks changed too, so a board refreshes its progress (as `announceParents`).
  const parents = events
    .filter((event) => (members.get(event.entityId) ?? []).length > 0)
    .map((event): ProjectEventInput => ({
      type: "task.updated",
      entity: "task",
      projectId,
      entityId: event.entityId,
      version: event.version ?? 0,
      actorAccountId: actor.accountId,
    }));

  await writePlaces(
    executor,
    deletedLeaving.map((row) => {
      const index = deletedPlaced.indexOf(row);
      return {
        taskId: row.id,
        before: { columnId: row.column_id, sprintId },
        after: {
          columnId: null,
          sprintId: target,
          position: index === -1 ? row.position : (keys[leaving.length + index] ?? row.position),
        },
      };
    }),
    true,
  );
  await publishEvents(executor, [...events, ...parents]);
  return { moved: leaving.length, unfinishedSubtasksKept };
}

/**
 * Turning sprints on for a project whose board holds tasks (WS-142 section 6): they become
 * an active "Sprint 1", from today to 14 days later, and keep their column, so the board
 * lists the same tasks. Each gets the sprint, a new version, a `field_changed` entry on
 * `sprintId` and `task.updated`. Tasks of a completed sprint stay in its record. The caller
 * has just turned sprints on and holds the project's row.
 */
export async function startFirstSprint(
  executor: Executor & Pick<Database, "insert">,
  actor: Actor,
  projectId: string,
): Promise<void> {
  const tasks = await executor.execute<{
    id: string;
    column_id: string;
    sprint_id: string | null;
    position: string;
  }>(sql`
    select t.id, t.column_id, t.sprint_id, t.position
    from tasks t join columns c on c.id = t.column_id left join sprints s on s.id = t.sprint_id
    where t.project_id = ${projectId} and t.deleted_at is null
      and (s.id is null or s.state = 'planned')
    order by c.position collate "C", t.position collate "C", t.id
    for update of t`);
  if (tasks.length === 0) return;

  const name = "Sprint 1";
  const [sprint] = await executor.execute<{ id: string; version: number }>(sql`
    insert into sprints (project_id, name, start_date, end_date, state, started_at, created_by)
    values (${projectId}, ${name}, current_date, current_date + 14, 'active', now(),
      ${actor.accountId})
    returning id, version`);
  if (!sprint) throw new Error("Sprint 1 was not created.");

  const changes = tasks.map((task) => ({
    taskId: task.id,
    before: { columnId: task.column_id, sprintId: task.sprint_id },
    after: { columnId: task.column_id, sprintId: sprint.id, position: task.position },
  }));
  const events = await applyPlaces(executor, actor, projectId, changes, false);
  await recordAudit(executor, {
    actor,
    action: "sprint.created",
    entity: "sprint",
    entityId: sprint.id,
    data: { projectId, name },
  });
  await recordAudit(executor, {
    actor,
    action: "sprint.started",
    entity: "sprint",
    entityId: sprint.id,
    data: { projectId, name, tasks: tasks.length },
  });
  await publishEvents(executor, events);
  await publishEvent(executor, {
    type: "sprint.changed",
    entity: "sprint",
    projectId,
    entityId: sprint.id,
    version: sprint.version,
    actorAccountId: actor.accountId,
  });
}
