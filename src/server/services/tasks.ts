import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import { positionBetween } from "@/lib/position";
import type { AccountKind } from "@/lib/schemas/account-ref";
import type { Severity } from "@/lib/schemas/bug-reports";
import type { ColumnCategory } from "@/lib/schemas/columns";
import { calendarDateSchema } from "@/lib/schemas/dates";
import type { LabelRef } from "@/lib/schemas/labels";
import {
  type AllTasksQuery,
  type BacklogQuery,
  type CreateTaskRequest,
  type MoveTaskRequest,
  ONLY_BUGS,
  type Priority,
  type Task,
  type TaskLink,
  type TaskListItem,
  type TaskListItemPage,
  type TaskListQuery,
  type TaskPage,
  type TaskSortField,
  type TaskSummary,
  type TaskType,
  type UpdateTaskRequest,
} from "@/lib/schemas/tasks";
import {
  type Actor,
  canDeleteTask,
  requirePermission,
  requireProjectAccess,
} from "@/server/auth/actor";
import { type Database, getDb } from "@/server/db/client";
import { taskLabels, tasks } from "@/server/db/schema";
import {
  accountInactive,
  forbidden,
  invalidRequest,
  notFound,
  versionConflict,
} from "@/server/http/errors";
import {
  cursorInstantSchema,
  decodeBacklogCursor,
  decodeBoardCursor,
  decodeTaskListCursor,
  encodeBacklogCursor,
  encodeBoardCursor,
  encodeTaskListCursor,
} from "@/server/http/pagination";

import { type ProjectEventInput, publishEvent } from "./events";
import { isPerson } from "./people";
import { claimTaskNumber, findProjectRef, lockWritableProject, reachableBy } from "./projects";
import { recordTaskEvent } from "./task-events";
import { taskFilterWhere } from "./task-filter";

type Executor = Pick<Database, "execute">;

const ISO_MS = sql`'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
/** Sorts after every position key (base-62, compared byte by byte): the backlog's place. */
const BACKLOG_COLUMN_POSITION = "~";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every column of a task's API shape, plus the two positions for the board cursor. A task
 * in the backlog has no column (WS-101), so the join on columns is a left join. Lists leave
 * the description out: their answer has none, and it can be 50 000 characters (WS-122).
 */
function taskSelect(extra: SQL = sql``, { description = false } = {}): SQL {
  return sql`
  select ${extra} t.id, t.number, p.key as project_key, p.name as project_name,
    c.name as column_name, c.category as column_category, t.project_id, t.type, t.title,
    ${description ? sql`t.description,` : sql``}
    t.column_id, t.assignee_team_id, t.assignee_account_id, t.epic_id,
    e.title as epic_title,
    tm.name as team_name,
    a.name as assignee_name, a.disabled_at is null as assignee_active,
    r.id as reporter_id, r.name as reporter_name, r.kind as reporter_kind,
    t.severity, t.fingerprint, t.occurrences,
    to_char(t.last_reported_at at time zone 'utc', ${ISO_MS}) as last_reported_at,
    t.priority, to_char(t.due_date, 'YYYY-MM-DD') as due_date,
    coalesce((
      select json_agg(json_build_object('id', l.id, 'name', l.name, 'colour', l.colour)
                      order by lower(l.name), l.id)
      from task_labels tl join labels l on l.id = tl.label_id
      where tl.task_id = t.id), '[]'::json) as labels,
    t.version, c.position as column_position, t.position,
    to_char(t.deleted_at at time zone 'utc', ${ISO_MS}) as deleted_at,
    to_char(t.created_at at time zone 'utc', ${ISO_MS}) as created_at,
    to_char(t.updated_at at time zone 'utc', ${ISO_MS}) as updated_at
  from tasks t
  join projects p on p.id = t.project_id
  left join columns c on c.id = t.column_id
  join accounts r on r.id = t.reporter_account_id
  left join teams tm on tm.id = t.assignee_team_id
  left join accounts a on a.id = t.assignee_account_id
  left join epics e on e.id = t.epic_id`;
}

/** One task, with its description. */
const TASK_SELECT = taskSelect(sql``, { description: true });
/** A list's tasks, without (WS-122). */
const SUMMARY_SELECT = taskSelect();

/** A row of `SUMMARY_SELECT`: what a list reads. */
interface SummaryRow extends Record<string, unknown> {
  id: string;
  number: number;
  project_key: string;
  project_name: string;
  column_name: string | null;
  column_category: ColumnCategory | null;
  project_id: string;
  type: TaskType;
  title: string;
  column_id: string | null;
  assignee_team_id: string | null;
  assignee_account_id: string | null;
  epic_id: string | null;
  epic_title: string | null;
  team_name: string | null;
  assignee_name: string | null;
  assignee_active: boolean | null;
  reporter_id: string;
  reporter_name: string;
  reporter_kind: AccountKind;
  severity: Severity | null;
  fingerprint: string | null;
  occurrences: number;
  last_reported_at: string | null;
  priority: Priority;
  due_date: string | null;
  labels: LabelRef[];
  version: number;
  column_position: string | null;
  position: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** A row of `TASK_SELECT`: one task. */
interface TaskRow extends SummaryRow {
  description: string;
}

function toSummary(row: SummaryRow): TaskSummary {
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
    reporter: { id: row.reporter_id, name: row.reporter_name, kind: row.reporter_kind },
    severity: row.severity,
    fingerprint: row.fingerprint,
    occurrences: row.occurrences,
    lastReportedAt: row.last_reported_at,
    priority: row.priority,
    dueDate: row.due_date,
    labels: row.labels,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function toListItem(row: SummaryRow): TaskListItem {
  return {
    ...toSummary(row),
    project: { id: row.project_id, key: row.project_key, name: row.project_name },
    column:
      row.column_id === null || row.column_name === null || row.column_category === null
        ? null
        : { id: row.column_id, name: row.column_name, category: row.column_category },
  };
}

function toTask(row: TaskRow, links: TaskLink[]): Task {
  return { ...toSummary(row), description: row.description, links };
}

/**
 * The links of a task, both ways, leaving out deleted tasks (WS-090 section 5): the task is a
 * regression of another (`outgoing`), or another is a regression of it (`incoming`).
 */
/**
 * A task's links, read from its side (WS-090, WS-134): both directions, `relates_to`
 * always `outgoing`, leaving out deleted tasks and tasks in projects the actor cannot reach.
 */
async function loadLinks(executor: Executor, actor: Actor, taskId: string): Promise<TaskLink[]> {
  const rows = await executor.execute<{
    type: TaskLink["type"];
    direction: TaskLink["direction"];
    id: string;
    key: string;
    title: string;
  }>(sql`
    select l.type, l.direction, t.id, p.key || '-' || t.number as key, t.title
    from (
      select type, 'outgoing' as direction, to_task_id as other
      from task_links where from_task_id = ${taskId}
      union all
      select type, case when type = 'relates_to' then 'outgoing' else 'incoming' end,
        from_task_id as other
      from task_links where to_task_id = ${taskId}
    ) l
    join tasks t on t.id = l.other and t.deleted_at is null
    join projects p on p.id = t.project_id
    where true ${reachableBy(actor)}
    order by l.type, l.direction desc, t.number`);
  return rows.map((row) => ({
    type: row.type,
    direction: row.direction,
    task: { id: row.id, key: row.key, title: row.title },
  }));
}

/** A task's full answer: its row and the links the actor may see. */
async function withLinks(executor: Executor, actor: Actor, row: TaskRow): Promise<Task> {
  return toTask(row, await loadLinks(executor, actor, row.id));
}

/** A live task's full answer, as `getTask` gives it, for services that change it (WS-134). */
export async function answerTask(executor: Executor, actor: Actor, id: string): Promise<Task> {
  const row = await findTask(executor, id);
  if (!row) throw taskNotFound();
  return withLinks(executor, actor, row);
}

function taskNotFound() {
  return notFound("There is no such task.");
}

function fieldError(path: string, message: string) {
  return invalidRequest([{ path, message }], "The request body is not valid.");
}

/** `t.id = ...` for a UUID; project key and number for a task key such as `OPA-12`. */
export function matchesTask(ref: string): SQL {
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

/**
 * The id and project of a task that is not deleted, or undefined; for services that work on
 * a task's children, such as comments (WS-034). `lock` as for `findTask`.
 */
export async function findLiveTask(
  executor: Executor,
  ref: string,
  lock: SQL = sql``,
): Promise<{ id: string; projectId: string } | undefined> {
  const row = await findTask(executor, ref, lock);
  return row && { id: row.id, projectId: row.project_id };
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
  requireProjectAccess(actor, row.project_id);
  return withLinks(db, actor, row);
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
  const project = await findProjectRef(db, actor, projectRef);
  if (!project) throw notFound("There is no such project.");

  const filtered = await taskFilterWhere(db, query, { actor, projectIds: [project.id] });
  // Only the deleted list shows backlog tasks, after every column's: `~` sorts after every
  // byte of a position key, so the board cursor keeps its shape (WS-101 section 5).
  const columnOrder = sql`coalesce(c.position, ${BACKLOG_COLUMN_POSITION}) collate "C"`;
  const after =
    query.cursor === undefined
      ? sql``
      : (() => {
          const cursor = decodeBoardCursor(query.cursor);
          return sql`and (${columnOrder}, t.position, t.id) >
            (${cursor.columnPosition}::text collate "C", ${cursor.position}::text collate "C", ${cursor.id}::uuid)`;
        })();
  const live = deleted
    ? sql`t.deleted_at is not null`
    : sql`t.deleted_at is null and t.column_id is not null`;

  const rows = await db.execute<SummaryRow>(sql`
    ${SUMMARY_SELECT}
    where t.project_id = ${project.id} and ${live}
      ${filtered} ${after}
    order by ${columnOrder}, t.position, t.id
    limit ${query.limit + 1}`);

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(toSummary),
    nextCursor:
      rows.length > query.limit && last
        ? encodeBoardCursor({
            columnPosition: last.column_position ?? BACKLOG_COLUMN_POSITION,
            position: last.position,
            id: last.id,
          })
        : null,
  };
}

/**
 * The project's backlog (WS-101): its live tasks with no column, in backlog order, with a
 * keyset cursor on position and id.
 */
export async function listBacklog(
  actor: Actor,
  projectRef: string,
  query: BacklogQuery,
  db: Database = getDb(),
): Promise<TaskPage> {
  requirePermission(actor, "tasks:read");
  const project = await findProjectRef(db, actor, projectRef);
  if (!project) throw notFound("There is no such project.");
  const filtered = await taskFilterWhere(db, query, { actor, projectIds: [project.id] });

  const after =
    query.cursor === undefined
      ? sql``
      : (() => {
          const cursor = decodeBacklogCursor(query.cursor);
          return sql`and (t.position, t.id) > (${cursor.position}::text collate "C", ${cursor.id}::uuid)`;
        })();

  const rows = await db.execute<SummaryRow>(sql`
    ${SUMMARY_SELECT}
    where t.project_id = ${project.id} and t.column_id is null and t.deleted_at is null
      ${filtered} ${after}
    order by t.position, t.id
    limit ${query.limit + 1}`);

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(toSummary),
    nextCursor:
      rows.length > query.limit && last
        ? encodeBacklogCursor({ position: last.position, id: last.id })
        : null,
  };
}

const ISO_US = sql`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
const PRIORITY_RANK = sql`(case t.priority when 'none' then 0 when 'low' then 1
  when 'medium' then 2 when 'high' then 3 else 4 end)`;
const NO_DUE_DATE = sql`date '0001-01-01'`;

/** One key of an order (WS-118 section 5): what to order by, as text, and back. */
interface SortKey {
  expression: SQL;
  text: SQL;
  cast: SQL;
  /**
   * What a value read back from a cursor must be, so a bad one is a `400` before it reaches
   * the cast (WS-118 deviation 2); dates must be real ones (WS-121).
   */
  value: z.ZodType<string>;
  /** The due date's "has none" key keeps tasks with no date last both ways. */
  alwaysAscending?: true;
}

function timestampKey(column: SQL): SortKey {
  return {
    expression: column,
    text: sql`to_char(${column} at time zone 'utc', ${ISO_US})`,
    cast: sql`::timestamptz`,
    value: cursorInstantSchema,
  };
}

const SORT_KEYS: Record<TaskSortField, SortKey[]> = {
  key: [
    {
      expression: sql`p.key collate "C"`,
      text: sql`p.key`,
      cast: sql`::text collate "C"`,
      value: z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/),
    },
    {
      expression: sql`t.number`,
      text: sql`t.number::text`,
      cast: sql`::int`,
      value: z.string().regex(/^\d{1,9}$/),
    },
  ],
  title: [
    {
      expression: sql`lower(t.title) collate "C"`,
      text: sql`lower(t.title)`,
      cast: sql`::text collate "C"`,
      value: z.string().regex(/^[\s\S]{1,800}$/),
    },
  ],
  priority: [
    {
      expression: PRIORITY_RANK,
      text: sql`${PRIORITY_RANK}::text`,
      cast: sql`::int`,
      value: z.string().regex(/^[0-4]$/),
    },
  ],
  dueDate: [
    {
      expression: sql`(t.due_date is null)`,
      text: sql`(t.due_date is null)::text`,
      cast: sql`::boolean`,
      value: z.string().regex(/^(true|false)$/),
      alwaysAscending: true,
    },
    {
      expression: sql`coalesce(t.due_date, ${NO_DUE_DATE})`,
      text: sql`to_char(coalesce(t.due_date, ${NO_DUE_DATE}), 'YYYY-MM-DD')`,
      cast: sql`::date`,
      value: calendarDateSchema,
    },
  ],
  created: [timestampKey(sql`t.created_at`)],
  updated: [timestampKey(sql`t.updated_at`)],
};

/** The rows after a cursor, in an order whose last key is the id, in the sort's direction. */
function afterCursor(keys: SortKey[], descending: boolean, values: string[], id: string): SQL {
  const ors: SQL[] = [];
  for (let index = 0; index <= keys.length; index += 1) {
    const ands: SQL[] = [];
    for (let before = 0; before < index; before += 1) {
      const key = keys[before];
      if (key) ands.push(sql`${key.expression} = ${values[before]}${key.cast}`);
    }
    const key = keys[index];
    if (key) {
      const down = descending && key.alwaysAscending !== true;
      ands.push(
        down
          ? sql`${key.expression} < ${values[index]}${key.cast}`
          : sql`${key.expression} > ${values[index]}${key.cast}`,
      );
    } else {
      ands.push(descending ? sql`t.id < ${id}::uuid` : sql`t.id > ${id}::uuid`);
    }
    ors.push(sql`(${sql.join(ands, sql` and `)})`);
  }
  return sql`and (${sql.join(ors, sql` or `)})`;
}

/**
 * The live tasks of every project the actor may read, or of the projects named, in the
 * order `sort` gives, with a keyset cursor (WS-118). The restriction is in the query, so
 * a restricted agent's pages are full.
 */
export async function listAllTasks(
  actor: Actor,
  query: AllTasksQuery,
  db: Database = getDb(),
): Promise<TaskListItemPage> {
  requirePermission(actor, "tasks:read");
  let projectIds: string[] | null = null;
  if (query.projectId !== undefined) {
    projectIds = [];
    for (const ref of query.projectId) {
      const project = await findProjectRef(db, actor, ref);
      if (!project) throw notFound("There is no such project.");
      projectIds.push(project.id);
    }
  }
  const scope =
    projectIds === null
      ? sql`p.archived_at is null ${reachableBy(actor)}`
      : sql`t.project_id in (${sql.join(
          [...new Set(projectIds)].map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;
  const filtered = await taskFilterWhere(db, query, { actor, projectIds });

  const descending = query.sort.startsWith("-");
  const field = query.sort.replace(/^-/, "") as TaskSortField;
  const keys = SORT_KEYS[field];
  let after = sql``;
  if (query.cursor !== undefined) {
    const cursor = decodeTaskListCursor(query.cursor, query.sort, keys.length);
    if (!keys.every((key, index) => key.value.safeParse(cursor.values[index] ?? "").success)) {
      throw invalidRequest(
        [{ path: "cursor", message: "Invalid cursor." }],
        "The query string is not valid.",
      );
    }
    after = afterCursor(keys, descending, cursor.values, cursor.id);
  }
  const order = sql.join(
    [
      ...keys.map((key) =>
        descending && key.alwaysAscending !== true
          ? sql`${key.expression} desc`
          : sql`${key.expression}`,
      ),
      descending ? sql`t.id desc` : sql`t.id`,
    ],
    sql`, `,
  );
  const sortValues = sql`array[${sql.join(
    keys.map((key) => key.text),
    sql`, `,
  )}] as sort_values,`;

  const rows = await db.execute<SummaryRow & { sort_values: string[] }>(sql`
    ${taskSelect(sortValues)}
    where t.deleted_at is null and ${scope} ${filtered} ${after}
    order by ${order}
    limit ${query.limit + 1}`);

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(toListItem),
    nextCursor:
      rows.length > query.limit && last
        ? encodeTaskListCursor({ sort: query.sort, values: last.sort_values, id: last.id })
        : null,
  };
}

type TaskEventType =
  "task.created" | "task.updated" | "task.moved" | "task.deleted" | "task.restored";

/** The event that announces a write to a task, with its version after the write (WS-045). */
function taskEvent(
  type: TaskEventType,
  task: { id: string; project_id: string; version: number },
  actor: Actor,
): ProjectEventInput {
  return {
    type,
    entity: "task",
    projectId: task.project_id,
    entityId: task.id,
    version: task.version,
    actorAccountId: actor.accountId,
  };
}

/** The tasks of one column, or of the project's backlog when `columnId` is null (WS-101). */
function placeOf(projectId: string, columnId: string | null): SQL {
  return columnId === null
    ? sql`project_id = ${projectId} and column_id is null`
    : sql`column_id = ${columnId}`;
}

interface NamedLabel {
  id: string;
  name: string;
}

/** Labels as the history writes them: id and name, by name (WS-107 section 5). */
function named(labels: readonly LabelRef[]): NamedLabel[] {
  return labels.map((label) => ({ id: label.id, name: label.name }));
}

/**
 * The labels of `ids`, by name, all of the project, else `400` naming `labelIds`. Label
 * deletions lock the project exclusively and task writes hold its shared lock, so none can
 * vanish before the transaction ends.
 */
async function projectLabels(
  executor: Executor,
  projectId: string,
  ids: readonly string[],
): Promise<NamedLabel[]> {
  if (ids.length === 0) return [];
  const rows = await executor.execute<{ id: string; name: string }>(sql`
    select id, name from labels
    where project_id = ${projectId}
      and id in (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
    order by lower(name), id`);
  if (rows.length !== ids.length) throw fieldError("labelIds", "Not a label of this project.");
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

/** Replaces the task's labels with `labels`. */
async function setLabels(
  executor: Executor & Pick<Database, "insert">,
  taskId: string,
  labels: readonly NamedLabel[],
): Promise<void> {
  await executor.execute(sql`delete from task_labels where task_id = ${taskId}`);
  if (labels.length > 0) {
    await executor
      .insert(taskLabels)
      .values(labels.map((label) => ({ taskId, labelId: label.id })));
  }
}

function sameLabels(a: readonly NamedLabel[], b: readonly NamedLabel[]): boolean {
  const ids = new Set(a.map((label) => label.id));
  return a.length === b.length && b.every((label) => ids.has(label.id));
}

export async function createTask(
  actor: Actor,
  projectRef: string,
  input: CreateTaskRequest,
  db: Database = getDb(),
): Promise<Task> {
  requirePermission(actor, "tasks:write");
  // Applying labels is a labels permission too (doc 0003 section 3, WT-07 decision 10).
  if (input.labelIds !== undefined) requirePermission(actor, "labels:write");

  return db.transaction(async (tx) => {
    // Locks the project: creations in it run one at a time (WS-030 section 3).
    const project = await claimTaskNumber(tx, actor, projectRef);

    // Locks the column: creations and moves into it run one at a time (WS-031 section 3).
    // The backlog has no row of its own: the project row, locked above, guards it (WS-101).
    let columnId: string | null = null;
    if (input.columnId !== null) {
      const [column] = await tx.execute<{ id: string }>(
        input.columnId === undefined
          ? sql`select id from columns where project_id = ${project.id}
                order by position limit 1 for no key update`
          : sql`select id from columns where id = ${input.columnId} and project_id = ${project.id}
                for no key update`,
      );
      if (!column) throw fieldError("columnId", "Not a column of this project.");
      columnId = column.id;
    }

    if (input.assigneeTeamId !== undefined) await assertTeam(tx, input.assigneeTeamId);
    if (input.assigneeAccountId !== undefined) {
      await assertAssignablePerson(tx, input.assigneeAccountId);
    }
    if (input.epicId !== undefined) await assertEpic(tx, input.epicId, project.id);
    const labels =
      input.labelIds === undefined
        ? undefined
        : await projectLabels(tx, project.id, input.labelIds);

    // Deleted tasks keep their place, so they count here too.
    const [last] = await tx.execute<{ position: string }>(
      sql`select position from tasks where ${placeOf(project.id, columnId)}
          order by position desc limit 1`,
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
        columnId,
        position: positionBetween(last?.position ?? null, null),
        assigneeTeamId: input.assigneeTeamId ?? null,
        assigneeAccountId: input.assigneeAccountId ?? null,
        epicId: input.epicId ?? null,
        severity: input.severity ?? null,
        priority: input.priority ?? "none",
        dueDate: input.dueDate ?? null,
        reporterAccountId: actor.accountId,
      })
      .returning({ id: tasks.id });
    if (!row) throw taskNotFound();
    if (labels !== undefined) await setLabels(tx, row.id, labels);

    const key = `${project.key}-${String(project.number)}`;
    await recordTaskEvent(tx, {
      taskId: row.id,
      actor,
      type: "created",
      newValue: {
        key,
        type,
        title: input.title,
        columnId,
        ...(input.severity === undefined ? {} : { severity: input.severity }),
        ...(input.priority === undefined ? {} : { priority: input.priority }),
        ...(input.dueDate === undefined ? {} : { dueDate: input.dueDate }),
        ...(labels === undefined ? {} : { labels }),
      },
    });

    const created = await findTask(tx, row.id);
    if (!created) throw taskNotFound();
    await publishEvent(tx, taskEvent("task.created", created, actor));
    return toTask(created, []);
  });
}

/** The editable fields, in the order their events are recorded. */
const EDITABLE = [
  ["title", "title"],
  ["description", "description"],
  ["type", "type"],
  ["severity", "severity"],
  ["priority", "priority"],
  ["dueDate", "due_date"],
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
  if (input.labelIds !== undefined) requirePermission(actor, "labels:write");

  return db.transaction(async (tx) => {
    const found = await findTask(tx, ref);
    if (!found) throw taskNotFound();
    await lockWritableProject(tx, actor, found.project_id);
    const before = await findTask(tx, found.id, sql`for update of t`);
    if (!before) throw taskNotFound();
    if (before.version !== input.version) throw versionConflict(await withLinks(tx, actor, before));

    const type = input.type ?? before.type;
    // Only bugs have a severity; a task that stops being a bug loses it (WS-088).
    if (type !== "bug" && input.severity !== undefined && input.severity !== null) {
      throw fieldError("severity", ONLY_BUGS);
    }
    const after = {
      title: input.title ?? before.title,
      description: input.description ?? before.description,
      type,
      severity:
        type !== "bug" ? null : input.severity === undefined ? before.severity : input.severity,
      priority: input.priority ?? before.priority,
      dueDate: input.dueDate === undefined ? before.due_date : input.dueDate,
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
    const labelsBefore = named(before.labels);
    const labelsAfter =
      input.labelIds === undefined
        ? labelsBefore
        : await projectLabels(tx, before.project_id, input.labelIds);
    const labelsChanged = !sameLabels(labelsBefore, labelsAfter);
    if (labelsChanged) await setLabels(tx, before.id, labelsAfter);

    await tx.execute(sql`
      update tasks set
        title = ${after.title}, description = ${after.description}, type = ${after.type},
        severity = ${after.severity}, priority = ${after.priority}, due_date = ${after.dueDate},
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
    if (labelsChanged) {
      await recordTaskEvent(tx, {
        taskId: before.id,
        actor,
        type: "field_changed",
        field: "labels",
        oldValue: labelsBefore,
        newValue: labelsAfter,
      });
    }

    const updated = await findTask(tx, before.id);
    if (!updated) throw taskNotFound();
    await publishEvent(tx, taskEvent("task.updated", updated, actor));
    return withLinks(tx, actor, updated);
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
    // A move into the backlog locks the project row, which guards the backlog's order as a
    // column's row guards its own (WS-101 section 2).
    const toBacklog = input.columnId === null;
    await lockWritableProject(tx, actor, found.project_id, toBacklog ? "exclusive" : "shared");

    if (input.columnId !== null) {
      const [column] = await tx.execute(sql`
        select id from columns where id = ${input.columnId} and project_id = ${found.project_id}
        for no key update`);
      if (!column) throw fieldError("columnId", "Not a column of this project.");
    }

    const before = await findTask(tx, found.id, sql`for update of t`);
    if (!before) throw taskNotFound();
    if (before.version !== input.version) throw versionConflict(await withLinks(tx, actor, before));

    // Neighbours are read over every task of the column, deleted or not (deleted tasks keep
    // their place), leaving the moved task out. Positions compare byte by byte (A2).
    const others = sql`${placeOf(before.project_id, input.columnId)} and id <> ${before.id}`;
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
      if (!anchor) {
        throw fieldError(
          anchorField,
          toBacklog ? "Not another task of the backlog." : "Not another task of the target column.",
        );
      }
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
    await publishEvent(tx, taskEvent("task.moved", moved, actor));
    return withLinks(tx, actor, moved);
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
    await lockWritableProject(tx, actor, found.project_id);
    const task = await findTask(tx, found.id, sql`for update of t`);
    if (!task) throw taskNotFound();
    if (!canDeleteTask(actor, { reporterId: task.reporter_id })) throw forbidden();

    const [deleted] = await tx.execute<{ version: number }>(sql`
      update tasks set deleted_at = now(), deleted_by = ${actor.accountId},
        version = version + 1, updated_at = now()
      where id = ${task.id}
      returning version`);
    if (!deleted) throw taskNotFound();
    await recordTaskEvent(tx, { taskId: task.id, actor, type: "deleted" });
    await publishEvent(tx, taskEvent("task.deleted", { ...task, version: deleted.version }, actor));
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
    await lockWritableProject(tx, actor, found.project_id);
    const task = await findAnyTask(tx, found.id, sql`for update of t`);
    if (!task) throw taskNotFound();
    if (task.deleted_at === null) return withLinks(tx, actor, task);

    await tx.execute(sql`
      update tasks set deleted_at = null, deleted_by = null,
        version = version + 1, updated_at = now()
      where id = ${task.id}`);
    await recordTaskEvent(tx, { taskId: task.id, actor, type: "restored" });

    const restored = await findTask(tx, task.id);
    if (!restored) throw taskNotFound();
    await publishEvent(tx, taskEvent("task.restored", restored, actor));
    return withLinks(tx, actor, restored);
  });
}
