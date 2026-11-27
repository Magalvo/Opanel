import { type SQL, sql } from "drizzle-orm";

import { type TaskFilter, taskKeySchema } from "@/lib/schemas/tasks";
import type { Actor } from "@/server/auth/actor";
import type { Database } from "@/server/db/client";
import { invalidRequest } from "@/server/http/errors";

import { reachableBy } from "./projects";

// One builder for the filters of every task list (WS-116 section 3). Its conditions use the
// aliases of `TASK_SELECT` in `tasks.ts`: `t` tasks, `p` projects, `c` columns (a left
// join) and `r` the reporter.

type Executor = Pick<Database, "execute">;

/** The filters a list takes; the board list adds its columns. */
export interface TaskListFilter extends TaskFilter {
  columnId?: string[] | undefined;
}

function list(values: readonly string[], cast: SQL): SQL {
  return sql.join(
    values.map((value) => sql`${value}${cast}`),
    sql`, `,
  );
}

/** `column in (...)`, or-ed with `column is null` when `nullValue` is among the values. */
function anyOf(column: SQL, values: readonly string[], nullValue?: string, cast = sql``): SQL {
  const given = values.filter((value) => value !== nullValue);
  const parts: SQL[] = [];
  if (given.length > 0) parts.push(sql`${column} in (${list(given, cast)})`);
  if (nullValue !== undefined && values.includes(nullValue)) parts.push(sql`${column} is null`);
  return sql`(${sql.join(parts, sql` or `)})`;
}

function withMe(values: readonly string[], actor: Actor): string[] {
  return values.map((value) => (value === "me" ? actor.accountId : value));
}

/**
 * The text search (WS-116 section 4): a task key finds that task; otherwise every word
 * must match, the last one as a prefix when it is letters and digits only.
 */
function search(q: string): SQL {
  const key = taskKeySchema.safeParse(q.toUpperCase());
  if (key.success) {
    const dash = key.data.lastIndexOf("-");
    return sql`(p.key = ${key.data.slice(0, dash)} and t.number = ${Number(key.data.slice(dash + 1))})`;
  }
  const pieces = q.split(/\s+/u).filter((piece) => piece.length > 0);
  const last = pieces.at(-1) ?? "";
  if (!/^[\p{L}\p{N}]+$/u.test(last)) {
    return sql`t.search @@ plainto_tsquery('simple', ${q})`;
  }
  const prefix = sql`to_tsquery('simple', ${`${last}:*`})`;
  const rest = pieces.slice(0, -1).join(" ");
  return rest.length === 0
    ? sql`t.search @@ ${prefix}`
    : sql`t.search @@ (plainto_tsquery('simple', ${rest}) && ${prefix})`;
}

/**
 * `parentId` (WS-133 section 9): the sub-tasks of the tasks named by id or key, or the tasks
 * with no parent for `none`. A task of another project, or none at all, matches nothing.
 */
function parentOf(values: readonly string[]): SQL {
  const parts: SQL[] = [];
  const ids = values.filter((value) => value !== "none" && !taskKeySchema.safeParse(value).success);
  const keys = values.filter((value) => taskKeySchema.safeParse(value).success);
  if (ids.length > 0) parts.push(sql`t.parent_task_id in (${list(ids, sql`::uuid`)})`);
  for (const key of keys) {
    const dash = key.lastIndexOf("-");
    parts.push(sql`t.parent_task_id in (
      select pt.id from tasks pt join projects pp on pp.id = pt.project_id
      where pp.key = ${key.slice(0, dash)} and pt.number = ${Number(key.slice(dash + 1))})`);
  }
  if (values.includes("none")) parts.push(sql`t.parent_task_id is null`);
  return sql`(${sql.join(parts, sql` or `)})`;
}

/**
 * `sprintId` (WS-141 section 9): a sprint's tasks, unscheduled ones for `none`, and the
 * tasks of their project's active sprint for `active`. A sprint of another project, or none
 * at all, matches nothing.
 */
function sprintOf(values: readonly string[]): SQL {
  const parts: SQL[] = [];
  const ids = values.filter((value) => value !== "none" && value !== "active");
  if (ids.length > 0) parts.push(sql`t.sprint_id in (${list(ids, sql`::uuid`)})`);
  if (values.includes("none")) parts.push(sql`t.sprint_id is null`);
  if (values.includes("active")) {
    parts.push(sql`t.sprint_id in (select s.id from sprints s where s.state = 'active')`);
  }
  return sql`(${sql.join(parts, sql` or `)})`;
}

/** The projects a list covers: some named ones, or every one the actor may read (WS-118). */
export interface TaskListScope {
  actor: Actor;
  projectIds: readonly string[] | null;
}

/**
 * Throws `400` naming the field when a column, label or epic is outside the list's
 * projects, as an unknown `columnId` always did (WS-116 section 3, WS-118 section 4).
 */
async function checkOwned(executor: Executor, filter: TaskListFilter, scope: TaskListScope) {
  const inScope =
    scope.projectIds === null
      ? sql`project_id in (select p.id from projects p where true ${reachableBy(scope.actor)})`
      : sql`project_id in (${list([...new Set(scope.projectIds)], sql`::uuid`)})`;
  const where = scope.projectIds?.length === 1 ? "this project" : "the projects listed";
  const checks: [keyof TaskListFilter, string, string[]][] = [
    ["columnId", "columns", (filter.columnId ?? []).filter((id) => id !== "backlog")],
    ["labelId", "labels", filter.labelId ?? []],
    ["epicId", "epics", (filter.epicId ?? []).filter((id) => id !== "none")],
  ];
  const nouns = { columnId: "column", labelId: "label", epicId: "epic" } as Record<string, string>;
  for (const [field, table, ids] of checks) {
    if (ids.length === 0) continue;
    const unique = [...new Set(ids)];
    const [row] = await executor.execute<{ found: number }>(sql`
      select count(*)::int as found from ${sql.identifier(table)}
      where ${inScope} and id in (${list(unique, sql`::uuid`)})`);
    if ((row?.found ?? 0) !== unique.length) {
      throw invalidRequest(
        [{ path: field, message: `Not a ${nouns[field] ?? "thing"} of ${where}.` }],
        "The query string is not valid.",
      );
    }
  }
}

/**
 * The `and ...` conditions of a filter, for a list of the scope's tasks. Every value is a
 * bound parameter.
 */
export async function taskFilterWhere(
  executor: Executor,
  filter: TaskListFilter,
  context: TaskListScope,
): Promise<SQL> {
  await checkOwned(executor, filter, context);
  const { actor } = context;
  const conditions: SQL[] = [];

  if (filter.q !== undefined) conditions.push(search(filter.q));
  if (filter.type) conditions.push(anyOf(sql`t.type`, filter.type));
  if (filter.columnId) {
    conditions.push(anyOf(sql`t.column_id`, filter.columnId, "backlog", sql`::uuid`));
  }
  if (filter.category) conditions.push(anyOf(sql`c.category`, filter.category));
  if (filter.done === true) conditions.push(sql`c.category = 'done'`);
  if (filter.done === false) conditions.push(sql`c.category is distinct from 'done'`);
  if (filter.assigneeTeamId) {
    conditions.push(anyOf(sql`t.assignee_team_id`, filter.assigneeTeamId, "none", sql`::uuid`));
  }
  if (filter.assigneeAccountId) {
    conditions.push(
      anyOf(
        sql`t.assignee_account_id`,
        withMe(filter.assigneeAccountId, actor),
        "none",
        sql`::uuid`,
      ),
    );
  }
  if (filter.reporterAccountId) {
    conditions.push(
      anyOf(
        sql`t.reporter_account_id`,
        withMe(filter.reporterAccountId, actor),
        undefined,
        sql`::uuid`,
      ),
    );
  }
  if (filter.reporterKind) conditions.push(sql`r.kind = ${filter.reporterKind}`);
  if (filter.labelId) {
    conditions.push(sql`exists (
      select 1 from task_labels tl
      where tl.task_id = t.id and tl.label_id in (${list(filter.labelId, sql`::uuid`)}))`);
  }
  if (filter.epicId) conditions.push(anyOf(sql`t.epic_id`, filter.epicId, "none", sql`::uuid`));
  if (filter.parentId) conditions.push(parentOf(filter.parentId));
  if (filter.sprintId) conditions.push(sprintOf(filter.sprintId));
  if (filter.priority) conditions.push(anyOf(sql`t.priority`, filter.priority));
  if (filter.severity) conditions.push(anyOf(sql`t.severity`, filter.severity));
  if (filter.dueFrom !== undefined) conditions.push(sql`t.due_date >= ${filter.dueFrom}::date`);
  if (filter.dueTo !== undefined) conditions.push(sql`t.due_date <= ${filter.dueTo}::date`);

  return conditions.length === 0 ? sql`` : sql`and ${sql.join(conditions, sql` and `)}`;
}
