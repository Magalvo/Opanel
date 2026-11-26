import { type SQL, sql } from "drizzle-orm";

import type { AccountKind, AccountRef } from "@/lib/schemas/account-ref";
import type {
  ActivityEvent,
  ActivityItem,
  ActivityPage,
  ActivityQuery,
  NamedRef,
} from "@/lib/schemas/activity";
import { type Actor, requirePermission, requireProjectAccess } from "@/server/auth/actor";
import { type Database, getDb } from "@/server/db/client";
import { notFound } from "@/server/http/errors";
import { decodeActivityCursor, encodeActivityCursor } from "@/server/http/pagination";

import { readComments } from "./comments";
import { findLiveTask } from "./tasks";

// A task's activity: its history and its comments in one list (WS-117).

type Executor = Pick<Database, "execute">;
type Json = ActivityEvent["oldValue"];

const ISO_MS = sql`'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const ISO_US = sql`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

interface KeyRow extends Record<string, unknown> {
  kind: "comment" | "event";
  id: string;
  cursor_time: string;
}

interface EventRow extends Record<string, unknown> {
  id: string;
  type: ActivityEvent["type"];
  field: string | null;
  old_value: Json;
  new_value: Json;
  actor_id: string | null;
  actor_name: string | null;
  actor_kind: AccountKind | null;
  created_at: string;
}

/** The ids an event names, by what they are, and the names read for them (section 3). */
interface Names {
  accounts: Map<string, AccountRef>;
  teams: Map<string, string>;
  epics: Map<string, string>;
  columns: Map<string, string>;
  /** A parent named by its key (WS-133 section 8). */
  tasks: Map<string, string>;
}

const FIELD_KIND: Record<string, "accounts" | "teams" | "epics" | "tasks" | undefined> = {
  assigneeAccountId: "accounts",
  assigneeTeamId: "teams",
  epicId: "epics",
  parentId: "tasks",
};

function isObject(value: Json): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function columnIdOf(value: Json): string | null | undefined {
  if (!isObject(value) || !("columnId" in value)) return undefined;
  const id = value.columnId;
  return typeof id === "string" ? id : null;
}

function idsIn(rows: EventRow[]) {
  const ids = {
    accounts: new Set<string>(),
    teams: new Set<string>(),
    epics: new Set<string>(),
    tasks: new Set<string>(),
  };
  const columns = new Set<string>();
  for (const row of rows) {
    const kind = row.field === null ? undefined : FIELD_KIND[row.field];
    for (const value of [row.old_value, row.new_value]) {
      if (row.type === "field_changed" && kind !== undefined && typeof value === "string") {
        ids[kind].add(value);
      }
      if (row.type === "moved" || row.type === "created") {
        const columnId = columnIdOf(value);
        if (typeof columnId === "string") columns.add(columnId);
      }
    }
  }
  return { ...ids, columns };
}

function inList(ids: Set<string>): SQL {
  return sql.join(
    [...ids].map((id) => sql`${id}::uuid`),
    sql`, `,
  );
}

async function readNames(executor: Executor, rows: EventRow[]): Promise<Names> {
  const ids = idsIn(rows);
  const names: Names = {
    accounts: new Map(),
    teams: new Map(),
    epics: new Map(),
    columns: new Map(),
    tasks: new Map(),
  };
  if (ids.accounts.size > 0) {
    const found = await executor.execute<{ id: string; name: string; kind: AccountKind }>(
      sql`select id, name, kind from accounts where id in (${inList(ids.accounts)})`,
    );
    for (const row of found) names.accounts.set(row.id, row);
  }
  const named: [keyof Omit<Names, "accounts">, SQL][] = [
    ["teams", sql`select id, name from teams`],
    ["epics", sql`select id, title as name from epics`],
    ["columns", sql`select id, name from columns`],
    // A task keeps its key when deleted, so a deleted parent is still named.
    [
      "tasks",
      sql`select t.id, p.key || '-' || t.number as name from tasks t join projects p on p.id = t.project_id`,
    ],
  ];
  for (const [kind, select] of named) {
    if (ids[kind].size === 0) continue;
    const found = await executor.execute<{ id: string; name: string }>(
      kind === "tasks"
        ? sql`${select} where t.id in (${inList(ids[kind])})`
        : sql`${select} where id in (${inList(ids[kind])})`,
    );
    for (const row of found) names[kind].set(row.id, row.name);
  }
  return names;
}

function columnRef(id: string | null, names: Names): NamedRef | null {
  return id === null ? null : { id, name: names.columns.get(id) ?? null };
}

/** An event's value with its ids named (WS-117 section 3). */
function named(row: EventRow, value: Json, names: Names): Json {
  if (value === null) return null;
  if (row.type === "field_changed" && row.field !== null && typeof value === "string") {
    const kind = FIELD_KIND[row.field];
    if (kind === "accounts") {
      return { ...(names.accounts.get(value) ?? { id: value, name: "", kind: "human" }) };
    }
    if (kind !== undefined) return { id: value, name: names[kind].get(value) ?? null };
  }
  if ((row.type === "moved" || row.type === "created") && isObject(value)) {
    const columnId = columnIdOf(value);
    if (columnId !== undefined) {
      const { columnId: _stored, ...rest } = value;
      return { ...rest, column: columnRef(columnId, names) };
    }
  }
  return value;
}

function toEvent(row: EventRow, names: Names): ActivityEvent {
  return {
    kind: "event",
    id: row.id,
    type: row.type,
    field: row.field,
    oldValue: named(row, row.old_value, names),
    newValue: named(row, row.new_value, names),
    actor:
      row.actor_id === null
        ? null
        : { id: row.actor_id, name: row.actor_name ?? "", kind: row.actor_kind ?? "human" },
    createdAt: row.created_at,
  };
}

async function readEvents(executor: Executor, ids: string[]): Promise<EventRow[]> {
  if (ids.length === 0) return [];
  return executor.execute<EventRow>(sql`
    select e.id::text as id, e.type, e.field, e.old_value, e.new_value,
      a.id as actor_id, a.name as actor_name, a.kind as actor_kind,
      to_char(e.created_at at time zone 'utc', ${ISO_MS}) as created_at
    from task_events e
    left join accounts a on a.id = e.actor_account_id
    where e.id in (${sql.join(
      ids.map((id) => sql`${id}::bigint`),
      sql`, `,
    )})`);
}

/**
 * A task's history and comments, oldest first, in one keyset-paged list (WS-117). Leaves
 * out `commented` entries: the comment is in the list. A deleted task is `404`.
 */
export async function listActivity(
  actor: Actor,
  taskRef: string,
  query: ActivityQuery,
  db: Database = getDb(),
): Promise<ActivityPage> {
  requirePermission(actor, "tasks:read");
  const task = await findLiveTask(db, taskRef);
  if (!task) throw notFound("There is no such task.");
  requireProjectAccess(actor, task.projectId);

  const after =
    query.cursor === undefined
      ? sql``
      : (() => {
          const cursor = decodeActivityCursor(query.cursor);
          return sql`where (x.created_at, x.kind collate "C", x.id collate "C") >
            (${cursor.createdAt}::timestamptz, ${cursor.kind}::text collate "C", ${cursor.id}::text collate "C")`;
        })();
  const keys = await db.execute<KeyRow>(sql`
    select x.kind, x.id, to_char(x.created_at at time zone 'utc', ${ISO_US}) as cursor_time
    from (
      select 'comment'::text as kind, c.id::text as id, c.created_at
      from comments c where c.task_id = ${task.id}
      union all
      select 'event'::text, e.id::text, e.created_at
      from task_events e where e.task_id = ${task.id} and e.type <> 'commented'
    ) x
    ${after}
    order by x.created_at, x.kind collate "C", x.id collate "C"
    limit ${query.limit + 1}`);

  const page = keys.slice(0, query.limit);
  const comments = new Map(
    (
      await readComments(
        db,
        page.filter((key) => key.kind === "comment").map((key) => key.id),
      )
    ).map((comment) => [comment.id, comment]),
  );
  const eventRows = await readEvents(
    db,
    page.filter((key) => key.kind === "event").map((key) => key.id),
  );
  const names = await readNames(db, eventRows);
  const events = new Map(eventRows.map((row) => [row.id, toEvent(row, names)]));

  const items = page.map((key): ActivityItem => {
    if (key.kind === "comment") {
      const comment = comments.get(key.id);
      if (!comment) throw new Error("A comment of the page was not read.");
      return { kind: "comment", comment };
    }
    const event = events.get(key.id);
    if (!event) throw new Error("An event of the page was not read.");
    return event;
  });
  const last = page.at(-1);
  return {
    items,
    nextCursor:
      keys.length > query.limit && last
        ? encodeActivityCursor({ createdAt: last.cursor_time, kind: last.kind, id: last.id })
        : null,
  };
}
