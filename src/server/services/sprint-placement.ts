import { sql } from "drizzle-orm";

import { positionBetween } from "@/lib/position";
import type { SprintState } from "@/lib/schemas/sprints";
import type { Actor } from "@/server/auth/actor";
import type { Database } from "@/server/db/client";
import {
  invalidRequest,
  noActiveSprint,
  sprintCompleted,
  sprintsDisabled,
  subtaskFollowsParent,
} from "@/server/http/errors";

import { publishEvents } from "./events";
import { recordTaskEvent } from "./task-events";

// Where a task goes (WT-10 decision 5, WS-141 section 3): every write that changes a task's
// column or sprint asks `placeFor`. In a project with sprints, a live task has a column
// exactly while its sprint is active or completed; without sprints, today's places hold.
//
// Lock order of a task write: the project (shared, or exclusive when the backlog's order
// may change), the columns, the active sprint (`for share`), then the task. Item D's start
// and completion lock the sprint `for update`, so they run one at a time with these writes.

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
      if (target === task.sprintId && task.position !== null) return kept(task, target);
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
  const moved = async () => {
    if (before.columnId === after.columnId) return;
    await recordTaskEvent(executor, {
      taskId,
      actor,
      type: "moved",
      oldValue: { columnId: before.columnId },
      newValue: { columnId: after.columnId },
    });
  };
  const sprint = async () => {
    if (before.sprintId === after.sprintId) return;
    await recordTaskEvent(executor, {
      taskId,
      actor,
      type: "field_changed",
      field: "sprintId",
      oldValue: before.sprintId,
      newValue: after.sprintId,
    });
  };
  if (movedFirst) {
    await moved();
    await sprint();
  } else {
    await sprint();
    await moved();
  }
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
