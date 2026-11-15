import { sql } from "drizzle-orm";

import type {
  Comment,
  CommentPage,
  CommentQuery,
  CreateCommentRequest,
} from "@/lib/schemas/comments";
import { type Actor, requirePermission } from "@/server/auth/actor";
import { type Database, getDb } from "@/server/db/client";
import { notFound } from "@/server/http/errors";
import { decodeCursor, encodeCursor } from "@/server/http/pagination";

import { lockWritableProject } from "./projects";
import { recordTaskEvent } from "./task-events";
import { findTaskRef } from "./tasks";

const ISO_MS = sql`'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const ISO_US = sql`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

/** A comment's API shape, plus its creation time at full precision for the cursor. */
const COMMENT_SELECT = sql`
  select c.id, c.task_id, c.kind, c.body, a.id as author_id, a.name as author_name,
    to_char(c.created_at at time zone 'utc', ${ISO_MS}) as created_at,
    to_char(c.created_at at time zone 'utc', ${ISO_US}) as cursor_time
  from comments c
  left join accounts a on a.id = c.author_account_id`;

interface CommentRow extends Record<string, unknown> {
  id: string;
  task_id: string;
  kind: "user";
  body: string;
  author_id: string | null;
  author_name: string | null;
  created_at: string;
  cursor_time: string;
}

function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    taskId: row.task_id,
    kind: row.kind,
    author:
      row.author_id === null || row.author_name === null
        ? null
        : { id: row.author_id, name: row.author_name },
    body: row.body,
    createdAt: row.created_at,
  };
}

function taskNotFound() {
  return notFound("There is no such task.");
}

/** A task's comments, oldest first. A deleted or unknown task is `404`. */
export async function listComments(
  actor: Actor,
  ref: string,
  query: CommentQuery,
  db: Database = getDb(),
): Promise<CommentPage> {
  requirePermission(actor, "tasks:read");

  const task = await findTaskRef(db, ref);
  if (!task) throw taskNotFound();

  const after =
    query.cursor === undefined
      ? sql``
      : (() => {
          const cursor = decodeCursor(query.cursor);
          return sql`and (c.created_at, c.id) > (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`;
        })();
  const rows = await db.execute<CommentRow>(sql`
    ${COMMENT_SELECT}
    where c.task_id = ${task.id}::uuid ${after}
    order by c.created_at, c.id
    limit ${query.limit + 1}`);

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(toComment),
    nextCursor:
      rows.length > query.limit && last
        ? encodeCursor({ createdAt: last.cursor_time, id: last.id })
        : null,
  };
}

/**
 * Comments on a task as the actor. The comment and its `commented` event commit together;
 * the task itself, including its `version`, is not touched (WS-034 section 2).
 */
export async function createComment(
  actor: Actor,
  ref: string,
  input: CreateCommentRequest,
  db: Database = getDb(),
): Promise<Comment> {
  requirePermission(actor, "comments:write");

  return db.transaction(async (tx) => {
    const found = await findTaskRef(tx, ref);
    if (!found) throw taskNotFound();
    await lockWritableProject(tx, found.projectId);

    const [created] = await tx.execute<{ id: string }>(sql`
      insert into comments (task_id, kind, author_account_id, body)
      values (${found.id}::uuid, 'user', ${actor.accountId}::uuid, ${input.body})
      returning id`);
    if (!created) throw new Error("The comment was not created.");
    await recordTaskEvent(tx, {
      taskId: found.id,
      actor,
      type: "commented",
      newValue: { commentId: created.id },
    });

    const [row] = await tx.execute<CommentRow>(
      sql`${COMMENT_SELECT} where c.id = ${created.id}::uuid`,
    );
    if (!row) throw new Error("The comment was not created.");
    return toComment(row);
  });
}
