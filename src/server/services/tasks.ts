import { type SQL, sql } from "drizzle-orm";

import { positionBetween } from "@/lib/position";
import type {
  CreateTaskRequest,
  MoveTaskRequest,
  Task,
  TaskListQuery,
  TaskPage,
  TaskSummary,
  TaskType,
  UpdateTaskRequest,
} from "@/lib/schemas/tasks";
import { type Actor, canDeleteTask, requirePermission } from "@/server/auth/actor";
import { type Database, getDb } from "@/server/db/client";
import { tasks } from "@/server/db/schema";
import {
  accountInactive,
  forbidden,
  invalidRequest,
  notFound,
  versionConflict,
} from "@/server/http/errors";
import { decodeBoardCursor, encodeBoardCursor } from "@/server/http/pagination";

import { isPerson } from "./people";
import { claimTaskNumber, findProjectRef, lockWritableProject } from "./projects";
import { recordTaskEvent } from "./task-events";

type Executor = Pick<Database, "execute">;

const ISO_MS = sql`'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every column of a task's API shape, plus the two positions for the board cursor. */
const TASK_SELECT = sql`
  select t.id, t.number, p.key as project_key, t.project_id, t.type, t.title, t.description,
    t.column_id, t.assignee_team_id, t.assignee_account_id, t.epic_id,
    e.title as epic_title,
    tm.name as team_name,
    a.name as assignee_name, a.disabled_at is null as assignee_active,
    r.id as reporter_id, r.name as reporter_name,
    t.version, c.position as column_position, t.position,
    to_char(t.deleted_at at time zone 'utc', ${ISO_MS}) as deleted_at,
    to_char(t.created_at at time zone 'utc', ${ISO_MS}) as created_at,
    to_char(t.updated_at at time zone 'utc', ${ISO_MS}) as updated_at
  from tasks t
  join projects p on p.id = t.project_id
  join columns c on c.id = t.column_id
  join accounts r on r.id = t.reporter_account_id
  left join teams tm on tm.id = t.assignee_team_id
  left join accounts a on a.id = t.assignee_account_id
  left join epics e on e.id = t.epic_id`;

interface TaskRow extends Record<string, unknown> {
  id: string;
  number: number;
  project_key: string;
  project_id: string;
  type: TaskType;
  title: string;
  description: string;
  column_id: string;
  assignee_team_id: string | null;
  assignee_account_id: string | null;
  epic_id: string | null;
  epic_title: string | null;
  team_name: string | null;
  assignee_name: string | null;
  assignee_active: boolean | null;
  reporter_id: string;
  reporter_name: string;
  version: number;
  column_position: string;
  position: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function toSummary(row: TaskRow): TaskSummary {
  return {
    id: row.id,
    key: `${row.project_key}-${String(row.number)}`,
    number: row.number,
    projectId: row.project_id,
    type: row.type,
    title: row.title,
    columnId: row.column_id,
    assigneeTeam:
      row.assignee_team_id === null
        ? null
        : { id: row.assignee_team_id, name: row.team_name ?? "" },
    assignee:
      row.assignee_account_id === null
        ? null
        : {
            id: row.assignee_account_id,
            name: row.assignee_name ?? "",
            active: row.assignee_active ?? false,
          },
    epic: row.epic_id === null ? null : { id: row.epic_id, title: row.epic_title ?? "" },
    reporter: { id: row.reporter_id, name: row.reporter_name },
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function toTask(row: TaskRow): Task {
  return { ...toSummary(row), description: row.description };
}

function taskNotFound() {
  return notFound("There is no such task.");
}

function fieldError(path: string, message: string) {
  return invalidRequest([{ path, message }], "The request body is not valid.");
}

/** `t.id = ...` for a UUID; project key and number for a task key such as `OPA-12`. */
function matchesTask(ref: string): SQL {
  if (UUID.test(ref)) return sql`t.id = ${ref}::uuid`;
  const dash = ref.lastIndexOf("-");
  return sql`p.key = ${ref.slice(0, dash)} and t.number = ${Number(ref.slice(dash + 1))}`;
}

/** A task that is not deleted, or undefined. `lock` locks the task row (`for update of t`). */
async function findTask(
  executor: Executor,
  ref: string,
  lock: SQL = sql``,
): Promise<TaskRow | undefined> {
  const [row] = await executor.execute<TaskRow>(
    sql`${TASK_SELECT} where ${matchesTask(ref)} and t.deleted_at is null ${lock}`,
  );
  return row;
}

/** The id and project of a task that is not deleted, for services that work on a task (WS-034). */
export async function findTaskRef(
  executor: Executor,
  ref: string,
): Promise<{ id: string; projectId: string } | undefined> {
  const row = await findTask(executor, ref);
  return row === undefined ? undefined : { id: row.id, projectId: row.project_id };
}

/** Like `findTask`, deleted or not: only restoring looks at deleted tasks by id or key. */
async function findAnyTask(
  executor: Executor,
  ref: string,
  lock: SQL = sql``,
): Promise<TaskRow | undefined> {
  const [row] = await executor.execute<TaskRow>(
    sql`${TASK_SELECT} where ${matchesTask(ref)} ${lock}`,
  );
  return row;
}

/** Throws unless the team exists. */
async function assertTeam(executor: Executor, teamId: string): Promise<void> {
  const [team] = await executor.execute(sql`select 1 from teams where id = ${teamId}`);
  if (!team) throw fieldError("assigneeTeamId", "There is no such team.");
}

/** Throws unless the epic belongs to the project (WS-033); open and closed epics both do. */
async function assertEpic(executor: Executor, epicId: string, projectId: string): Promise<void> {
  const [epic] = await executor.execute(
    sql`select 1 from epics where id = ${epicId} and project_id = ${projectId}`,
  );
  if (!epic) throw fieldError("epicId", "Not an epic of this project.");
}

/** Throws unless the account is an active person (WS-026). */
async function assertAssignablePerson(executor: Executor, accountId: string): Promise<void> {
  const [person] = await executor.execute<{ active: boolean }>(sql`
    select a.disabled_at is null as active from accounts a
    where a.id = ${accountId} and ${isPerson("a")}`);
  if (!person) throw fieldError("assigneeAccountId", "Not a person who can be assigned.");
  if (!person.active) throw accountInactive();
}

export async function getTask(actor: Actor, ref: string, db: Database = getDb()): Promise<Task> {
  requirePermission(actor, "tasks:read");
  const row = await findTask(db, ref);
  if (!row) throw taskNotFound();
  return toTask(row);
}

export async function listTasks(
  actor: Actor,
  projectRef: string,
  query: TaskListQuery,
  db: Database = getDb(),
): Promise<TaskPage> {
  requirePermission(actor, "tasks:read");
  // Only Managers and Admins see deleted tasks (WT-03 decision 11).
  const deleted = query.deleted === "true";
  if (deleted) requirePermission(actor, "tasks:delete_any");
  const project = await findProjectRef(db, projectRef);
  if (!project) throw notFound("There is no such project.");

  let inColumn = sql``;
  if (query.columnId !== undefined) {
    const [column] = await db.execute(
      sql`select 1 from columns where id = ${query.columnId} and project_id = ${project.id}`,
    );
    if (!column) {
      throw invalidRequest(
        [{ path: "columnId", message: "Not a column of this project." }],
        "The query string is not valid.",
      );
    }
    inColumn = sql`and t.column_id = ${query.columnId}`;
  }
  const after =
    query.cursor === undefined
      ? sql``
      : (() => {
          const cursor = decodeBoardCursor(query.cursor);
          return sql`and (c.position, t.position, t.id) >
            (${cursor.columnPosition}::text collate "C", ${cursor.position}::text collate "C", ${cursor.id}::uuid)`;
        })();

  const rows = await db.execute<TaskRow>(sql`
    ${TASK_SELECT}
    where t.project_id = ${project.id}
      and ${deleted ? sql`t.deleted_at is not null` : sql`t.deleted_at is null`}
      ${inColumn} ${after}
    order by c.position, t.position, t.id
    limit ${query.limit + 1}`);

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(toSummary),
    nextCursor:
      rows.length > query.limit && last
        ? encodeBoardCursor({
            columnPosition: last.column_position,
            position: last.position,
            id: last.id,
          })
        : null,
  };
}

export async function createTask(
  actor: Actor,
  projectRef: string,
  input: CreateTaskRequest,
  db: Database = getDb(),
): Promise<Task> {
  requirePermission(actor, "tasks:write");

  return db.transaction(async (tx) => {
    // Locks the project: creations in it run one at a time (WS-030 section 3).
    const project = await claimTaskNumber(tx, projectRef);

    // Locks the column: creations and moves into it run one at a time (WS-031 section 3).
    const [column] = await tx.execute<{ id: string }>(
      input.columnId === undefined
        ? sql`select id from columns where project_id = ${project.id}
              order by position limit 1 for no key update`
        : sql`select id from columns where id = ${input.columnId} and project_id = ${project.id}
              for no key update`,
    );
    if (!column) throw fieldError("columnId", "Not a column of this project.");

    if (input.assigneeTeamId !== undefined) await assertTeam(tx, input.assigneeTeamId);
    if (input.assigneeAccountId !== undefined) {
      await assertAssignablePerson(tx, input.assigneeAccountId);
    }
    if (input.epicId !== undefined) await assertEpic(tx, input.epicId, project.id);

    // Deleted tasks keep their place, so they count here too.
    const [last] = await tx.execute<{ position: string }>(
      sql`select position from tasks where column_id = ${column.id} order by position desc limit 1`,
    );
    const type = input.type ?? "task";
    const [row] = await tx
      .insert(tasks)
      .values({
        projectId: project.id,
        number: project.number,
        type,
        title: input.title,
        description: input.description ?? "",
        columnId: column.id,
        position: positionBetween(last?.position ?? null, null),
        assigneeTeamId: input.assigneeTeamId ?? null,
        assigneeAccountId: input.assigneeAccountId ?? null,
        epicId: input.epicId ?? null,
        reporterAccountId: actor.accountId,
      })
      .returning({ id: tasks.id });
    if (!row) throw taskNotFound();

    const key = `${project.key}-${String(project.number)}`;
    await recordTaskEvent(tx, {
      taskId: row.id,
      actor,
      type: "created",
      newValue: { key, type, title: input.title, columnId: column.id },
    });

    const created = await findTask(tx, row.id);
    if (!created) throw taskNotFound();
    return toTask(created);
  });
}

/** The editable fields, in the order their events are recorded. */
const EDITABLE = [
  ["title", "title"],
  ["description", "description"],
  ["type", "type"],
  ["assigneeTeamId", "assignee_team_id"],
  ["assigneeAccountId", "assignee_account_id"],
  ["epicId", "epic_id"],
] as const;

export async function updateTask(
  actor: Actor,
  ref: string,
  input: UpdateTaskRequest,
  db: Database = getDb(),
): Promise<Task> {
  requirePermission(actor, "tasks:write");

  return db.transaction(async (tx) => {
    const found = await findTask(tx, ref);
    if (!found) throw taskNotFound();
    await lockWritableProject(tx, found.project_id);
    const before = await findTask(tx, found.id, sql`for update of t`);
    if (!before) throw taskNotFound();
    if (before.version !== input.version) throw versionConflict(toTask(before));

    const after = {
      title: input.title ?? before.title,
      description: input.description ?? before.description,
      type: input.type ?? before.type,
      assigneeTeamId:
        input.assigneeTeamId === undefined ? before.assignee_team_id : input.assigneeTeamId,
      assigneeAccountId:
        input.assigneeAccountId === undefined
          ? before.assignee_account_id
          : input.assigneeAccountId,
      epicId: input.epicId === undefined ? before.epic_id : input.epicId,
    };
    if (after.assigneeTeamId !== null && after.assigneeTeamId !== before.assignee_team_id) {
      await assertTeam(tx, after.assigneeTeamId);
    }
    if (
      after.assigneeAccountId !== null &&
      after.assigneeAccountId !== before.assignee_account_id
    ) {
      await assertAssignablePerson(tx, after.assigneeAccountId);
    }
    if (after.epicId !== null && after.epicId !== before.epic_id) {
      await assertEpic(tx, after.epicId, before.project_id);
    }

    await tx.execute(sql`
      update tasks set
        title = ${after.title}, description = ${after.description}, type = ${after.type},
        assignee_team_id = ${after.assigneeTeamId}, assignee_account_id = ${after.assigneeAccountId},
        epic_id = ${after.epicId},
        version = version + 1, updated_at = now()
      where id = ${before.id}`);

    for (const [field, column] of EDITABLE) {
      const oldValue = before[column];
      const newValue = after[field];
      if (oldValue !== newValue) {
        await recordTaskEvent(tx, {
          taskId: before.id,
          actor,
          type: "field_changed",
          field,
          oldValue,
          newValue,
        });
      }
    }

    const updated = await findTask(tx, before.id);
    if (!updated) throw taskNotFound();
    return toTask(updated);
  });
}

/**
 * Moves a task to the end of a column, or right after or right before a task of it
 * (WS-031). Locks, in order: the project (shared), the target column, the task. Moves and
 * creations into one column therefore run one at a time, and the neighbours read here are
 * the ones committed. Records a `moved` event only when the column changes.
 */
export async function moveTask(
  actor: Actor,
  ref: string,
  input: MoveTaskRequest,
  db: Database = getDb(),
): Promise<Task> {
  requirePermission(actor, "tasks:write");

  return db.transaction(async (tx) => {
    const found = await findTask(tx, ref);
    if (!found) throw taskNotFound();
    await lockWritableProject(tx, found.project_id);

    const [column] = await tx.execute(sql`
      select id from columns where id = ${input.columnId} and project_id = ${found.project_id}
      for no key update`);
    if (!column) throw fieldError("columnId", "Not a column of this project.");

    const before = await findTask(tx, found.id, sql`for update of t`);
    if (!before) throw taskNotFound();
    if (before.version !== input.version) throw versionConflict(toTask(before));

    // Neighbours are read over every task of the column, deleted or not (deleted tasks keep
    // their place), leaving the moved task out. Positions compare byte by byte (A2).
    const others = sql`column_id = ${input.columnId} and id <> ${before.id}`;
    let previous: string | null;
    let next: string | null;
    const anchorField = input.afterTaskId !== undefined ? "afterTaskId" : "beforeTaskId";
    const anchorId = input.afterTaskId ?? input.beforeTaskId;
    if (anchorId === undefined) {
      const [last] = await tx.execute<{ position: string }>(
        sql`select position from tasks where ${others} order by position desc limit 1`,
      );
      previous = last?.position ?? null;
      next = null;
    } else {
      const [anchor] = await tx.execute<{ position: string }>(sql`
        select position from tasks
        where id = ${anchorId} and ${others} and deleted_at is null`);
      if (!anchor) throw fieldError(anchorField, "Not another task of the target column.");
      if (anchorField === "afterTaskId") {
        previous = anchor.position;
        const [following] = await tx.execute<{ position: string }>(sql`
          select position from tasks
          where ${others} and position > ${anchor.position}::text collate "C"
          order by position limit 1`);
        next = following?.position ?? null;
      } else {
        next = anchor.position;
        const [preceding] = await tx.execute<{ position: string }>(sql`
          select position from tasks
          where ${others} and position < ${anchor.position}::text collate "C"
          order by position desc limit 1`);
        previous = preceding?.position ?? null;
      }
    }

    // Already in that gap: keep the key, so a no-op move changes no position.
    const sameColumn = before.column_id === input.columnId;
    const inGap =
      sameColumn &&
      (previous === null || previous < before.position) &&
      (next === null || before.position < next);
    const position = inGap ? before.position : positionBetween(previous, next);

    await tx.execute(sql`
      update tasks set column_id = ${input.columnId}, position = ${position},
        version = version + 1, updated_at = now()
      where id = ${before.id}`);

    if (!sameColumn) {
      await recordTaskEvent(tx, {
        taskId: before.id,
        actor,
        type: "moved",
        oldValue: { columnId: before.column_id },
        newValue: { columnId: input.columnId },
      });
    }

    const moved = await findTask(tx, before.id);
    if (!moved) throw taskNotFound();
    return toTask(moved);
  });
}

/**
 * Soft-deletes a task (WT-03 decision 12, WS-032): it keeps its key, column and place, and
 * disappears from every view but the deleted list. Members delete only tasks they
 * reported; Managers and Admins any (`canDeleteTask`).
 */
export async function deleteTask(actor: Actor, ref: string, db: Database = getDb()): Promise<void> {
  requirePermission(actor, "tasks:delete_own");

  await db.transaction(async (tx) => {
    const found = await findTask(tx, ref);
    if (!found) throw taskNotFound();
    await lockWritableProject(tx, found.project_id);
    const task = await findTask(tx, found.id, sql`for update of t`);
    if (!task) throw taskNotFound();
    if (!canDeleteTask(actor, { reporterId: task.reporter_id })) throw forbidden();

    await tx.execute(sql`
      update tasks set deleted_at = now(), deleted_by = ${actor.accountId},
        version = version + 1, updated_at = now()
      where id = ${task.id}`);
    await recordTaskEvent(tx, { taskId: task.id, actor, type: "deleted" });
  });
}

/** Brings a deleted task back where it was. A task that is not deleted is returned as is. */
export async function restoreTask(
  actor: Actor,
  ref: string,
  db: Database = getDb(),
): Promise<Task> {
  requirePermission(actor, "tasks:delete_any");

  return db.transaction(async (tx) => {
    const found = await findAnyTask(tx, ref);
    if (!found) throw taskNotFound();
    await lockWritableProject(tx, found.project_id);
    const task = await findAnyTask(tx, found.id, sql`for update of t`);
    if (!task) throw taskNotFound();
    if (task.deleted_at === null) return toTask(task);

    await tx.execute(sql`
      update tasks set deleted_at = null, deleted_by = null,
        version = version + 1, updated_at = now()
      where id = ${task.id}`);
    await recordTaskEvent(tx, { taskId: task.id, actor, type: "restored" });

    const restored = await findTask(tx, task.id);
    if (!restored) throw taskNotFound();
    return toTask(restored);
  });
}
