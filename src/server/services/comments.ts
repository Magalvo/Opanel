import { sql } from "drizzle-orm";

import type { AccountKind } from "@/lib/schemas/account-ref";
import type {
  Comment,
  CommentKind,
  CommentPage,
  CommentQuery,
  CreateCommentRequest,
} from "@/lib/schemas/comments";
import { type Actor, requirePermission, requireProjectAccess } from "@/server/auth/actor";
import { type Database, getDb } from "@/server/db/client";
import { notFound } from "@/server/http/errors";
import { decodeCursor, encodeCursor } from "@/server/http/pagination";

import { publishEvent } from "./events";
import { lockWritableProject } from "./projects";
import { recordTaskEvent } from "./task-events";
import { findLiveTask } from "./tasks";

const ISO_MS = sql`'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const ISO_US = sql`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

const COMMENT_SELECT = sql`
  select c.id, c.task_id, c.kind, c.author_account_id, a.name as author_name, a.kind as author_kind,
    c.body,
    to_char(c.created_at at time zone 'utc', ${ISO_MS}) as created_at,
    to_char(c.created_at at time zone 'utc', ${ISO_US}) as cursor_time
  from comments c
  left join accounts a on a.id = c.author_account_id`;

interface CommentRow extends Record<string, unknown> {
  id: string;
  task_id: string;
  kind: CommentKind;
  author_account_id: string | null;
  author_name: string | null;
  author_kind: AccountKind | null;
  body: string;
  created_at: string;
  cursor_time: string;
}

function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    taskId: row.task_id,
    kind: row.kind,
    author:
      row.author_account_id === null
        ? null
        : {
            id: row.author_account_id,
            name: row.author_name ?? "",
            kind: row.author_kind ?? "human",
          },
    body: row.body,
    createdAt: row.created_at,
  };
}

function taskNotFound() {
  return notFound("There is no such task.");
}

/**
 * Lists a task's comments, oldest first (WS-034). A deleted task is `404`, as reading it is.
 */
export async function listComments(
  actor: Actor,
  taskRef: string,
  query: CommentQuery,
  db: Database = getDb(),
): Promise<CommentPage> {
  requirePermission(actor, "tasks:read");
  const task = await findLiveTask(db, taskRef);
  if (!task) throw taskNotFound();
  requireProjectAccess(actor, task.projectId);

  const after =
    query.cursor === undefined
      ? sql``
      : (() => {
          const cursor = decodeCursor(query.cursor);
          return sql`and (c.created_at, c.id) > (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`;
        })();
  const rows = await db.execute<CommentRow>(sql`
    ${COMMENT_SELECT}
    where c.task_id = ${task.id} ${after}
    order by c.created_at, c.id
    limit ${query.limit + 1}`);

  const items = rows.slice(0, query.limit);
  const last = items.at(-1);
  return {
    items: items.map(toComment),
    nextCursor:
      rows.length > query.limit && last
        ? encodeCursor({ createdAt: last.cursor_time, id: last.id })
        : null,
  };
}

type Executor = Pick<Database, "execute" | "insert">;

/**
 * Inserts a comment, records `commented` in the task's history with the actor, and publishes
 * `comment.created`, all with the caller's transaction (WS-034, WS-089).
 */
async function insertComment(
  tx: Executor,
  actor: Actor,
  task: { id: string; projectId: string },
  kind: CommentKind,
  body: string,
): Promise<{ id: string }> {
  const author = kind === "user" ? actor.accountId : null;
  const [inserted] = await tx.execute<{ id: string }>(sql`
    insert into comments (task_id, kind, author_account_id, body)
    values (${task.id}, ${kind}, ${author}, ${body})
    returning id`);
  if (!inserted) throw new Error("The comment was not created.");
  await recordTaskEvent(tx, {
    taskId: task.id,
    actor,
    type: "commented",
    newValue: { commentId: inserted.id },
  });
  await publishEvent(tx, {
    type: "comment.created",
    entity: "comment",
    projectId: task.projectId,
    entityId: inserted.id,
    taskId: task.id,
    version: null,
    actorAccountId: actor.accountId,
  });
  return inserted;
}

/**
 * Adds a `system` comment to a task, inside the caller's transaction: no author, shown as
 * "Opanel" (WS-034). Its history entry and event name the actor whose action caused it, such
 * as the agent whose report the triage pipeline handled (WS-089 section 5).
 */
export async function addSystemComment(
  tx: Executor,
  actor: Actor,
  task: { id: string; projectId: string },
  body: string,
): Promise<{ id: string }> {
  return insertComment(tx, actor, task, "system", body);
}

/**
 * Adds a `user` comment by the actor to a task that is not deleted (WS-034). The comment and
 * its `commented` history event commit together. The task itself, its `version` included,
 * does not change.
 */
export async function createComment(
  actor: Actor,
  taskRef: string,
  input: CreateCommentRequest,
  db: Database = getDb(),
): Promise<Comment> {
  requirePermission(actor, "comments:write");

  return db.transaction(async (tx) => {
    const found = await findLiveTask(tx, taskRef);
    if (!found) throw taskNotFound();
    await lockWritableProject(tx, actor, found.projectId);
    // Waits for a delete of the same task in flight (it takes `for update`), and then sees it.
    const task = await findLiveTask(tx, found.id, sql`for share of t`);
    if (!task) throw taskNotFound();

    const inserted = await insertComment(tx, actor, task, "user", input.body);

    const [row] = await tx.execute<CommentRow>(sql`${COMMENT_SELECT} where c.id = ${inserted.id}`);
    if (!row) throw new Error("The comment was not created.");
    return toComment(row);
  });
}
