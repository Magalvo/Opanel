import { sql } from "drizzle-orm";

import type { TaskLinkType } from "@/lib/schemas/bug-reports";
import { MAX_TASK_LINKS, type TaskLinkRequest } from "@/lib/schemas/task-links";
import type { Task } from "@/lib/schemas/tasks";
import { type Actor, requirePermission, requireProjectAccess } from "@/server/auth/actor";
import { type Database, getDb } from "@/server/db/client";
import { invalidRequest, linkExists, notFound, tooManyLinks } from "@/server/http/errors";

import { publishEvent } from "./events";
import { lockWritableProject } from "./projects";
import { recordTaskEvent } from "./task-events";
import { answerTask, matchesTask } from "./tasks";

// Links between tasks, added and removed by people and agents (doc 0003 section 7, WT-09
// decisions 3 and 6 to 10, WS-134). A task's `links` are read by `tasks.ts`.

type Executor = Pick<Database, "execute">;
type Transaction = Pick<Database, "execute" | "insert">;

/** A live task, as a link names it. */
export interface LinkedTask {
  id: string;
  key: string;
  projectId: string;
}

/** A row of `task_links`. */
export interface StoredLink {
  from: LinkedTask;
  to: LinkedTask;
  type: TaskLinkType;
}

type Direction = "outgoing" | "incoming";

async function findLinkedTask(executor: Executor, ref: string): Promise<LinkedTask | undefined> {
  const [row] = await executor.execute<{ id: string; key: string; project_id: string }>(sql`
    select t.id, p.key || '-' || t.number as key, t.project_id
    from tasks t join projects p on p.id = t.project_id
    where ${matchesTask(ref)} and t.deleted_at is null`);
  return row && { id: row.id, key: row.key, projectId: row.project_id };
}

function otherTaskError(message: string) {
  return invalidRequest([{ path: "taskId", message }], "The request is not valid.");
}

/**
 * Finds both tasks, locks their projects (refusing one out of reach or archived) and then
 * both task rows, each pair in id order so two opposite requests cannot deadlock.
 */
async function lockPair(
  tx: Executor,
  actor: Actor,
  ref: string,
  otherRef: string,
): Promise<{ self: LinkedTask; other: LinkedTask }> {
  const self = await findLinkedTask(tx, ref);
  if (!self) throw notFound("There is no such task.");
  // Out of reach before anything about the other task is said (WT-05 decision 7).
  requireProjectAccess(actor, self.projectId);
  const other = await findLinkedTask(tx, otherRef);
  if (!other) throw otherTaskError("There is no such task.");
  if (other.id === self.id) throw otherTaskError("A task cannot be linked to itself.");

  for (const projectId of [...new Set([self.projectId, other.projectId])].sort()) {
    await lockWritableProject(tx, actor, projectId);
  }
  const locked = await tx.execute<{ id: string }>(sql`
    select id from tasks where id in (${self.id}, ${other.id}) and deleted_at is null
    order by id for update`);
  if (!locked.some((row) => row.id === self.id)) throw notFound("There is no such task.");
  if (!locked.some((row) => row.id === other.id)) {
    throw otherTaskError("There is no such task.");
  }
  return { self, other };
}

/** The row a request names: `relates_to` always from the lower id (WT-09 decision 6). */
function storedLink(
  self: LinkedTask,
  other: LinkedTask,
  type: TaskLinkType,
  direction: Direction,
): StoredLink {
  if (type === "relates_to") {
    return self.id < other.id ? { from: self, to: other, type } : { from: other, to: self, type };
  }
  return direction === "outgoing"
    ? { from: self, to: other, type }
    : { from: other, to: self, type };
}

async function exists(tx: Executor, link: StoredLink): Promise<boolean> {
  const [row] = await tx.execute(sql`
    select 1 from task_links
    where from_task_id = ${link.from.id} and to_task_id = ${link.to.id} and type = ${link.type}`);
  return row !== undefined;
}

/** How many links a task has to tasks that are not deleted. */
async function countLinks(tx: Executor, taskId: string): Promise<number> {
  const [row] = await tx.execute<{ count: number }>(sql`
    select count(*)::int as count from (
      select to_task_id as other from task_links where from_task_id = ${taskId}
      union all
      select from_task_id from task_links where to_task_id = ${taskId}
    ) l
    join tasks t on t.id = l.other and t.deleted_at is null`);
  return row?.count ?? 0;
}

/** The link as `task` reads it, naming the other task (WT-09 decision 9). */
function readingFrom(task: LinkedTask, link: StoredLink) {
  const outgoing = link.type === "relates_to" || link.from.id === task.id;
  const other = link.from.id === task.id ? link.to : link.from;
  return {
    type: link.type,
    direction: outgoing ? "outgoing" : "incoming",
    task: { id: other.id, key: other.key },
  };
}

/**
 * Inserts a link, with its `linked` entries on both tasks; each task of `bump` gets a new
 * `version` and a `task.updated` (WT-09 decisions 9 and 10). The caller holds the locks
 * and has checked the rules: the triage pipeline calls it without the limit (WS-134
 * section 6).
 */
export async function insertLink(
  tx: Transaction,
  actor: Actor,
  link: StoredLink,
  bump: readonly LinkedTask[],
): Promise<void> {
  await tx.execute(sql`
    insert into task_links (from_task_id, to_task_id, type, created_by)
    values (${link.from.id}, ${link.to.id}, ${link.type}, ${actor.accountId})`);
  await recordChange(tx, actor, link, "linked", bump);
}

async function recordChange(
  tx: Transaction,
  actor: Actor,
  link: StoredLink,
  change: "linked" | "unlinked",
  bump: readonly LinkedTask[],
): Promise<void> {
  for (const task of [link.from, link.to]) {
    const value = readingFrom(task, link);
    await recordTaskEvent(tx, {
      taskId: task.id,
      actor,
      type: change,
      ...(change === "linked" ? { newValue: value } : { oldValue: value }),
    });
  }
  for (const task of bump) {
    const [bumped] = await tx.execute<{ version: number }>(sql`
      update tasks set version = version + 1, updated_at = now()
      where id = ${task.id} returning version`);
    if (!bumped) throw new Error("The linked task was not updated.");
    await publishEvent(tx, {
      type: "task.updated",
      entity: "task",
      projectId: task.projectId,
      entityId: task.id,
      version: bumped.version,
      actorAccountId: actor.accountId,
    });
  }
}

/** Links the task to another (WS-134 section 4); answers the task with its new links. */
export async function addTaskLink(
  actor: Actor,
  ref: string,
  input: TaskLinkRequest,
  db: Database = getDb(),
): Promise<Task> {
  requirePermission(actor, "tasks:write");

  return db.transaction(async (tx) => {
    const { self, other } = await lockPair(tx, actor, ref, input.taskId);
    const link = storedLink(self, other, input.type, input.direction);
    if (await exists(tx, link)) throw linkExists();
    for (const task of [self, other]) {
      if ((await countLinks(tx, task.id)) >= MAX_TASK_LINKS) {
        throw tooManyLinks(
          `${task.key} already has ${String(MAX_TASK_LINKS)} links. Remove one first.`,
        );
      }
    }
    await insertLink(tx, actor, link, [self, other]);
    return answerTask(tx, actor, self.id);
  });
}

/** Removes the link the query names, as the task reads it (WS-134 section 4). */
export async function removeTaskLink(
  actor: Actor,
  ref: string,
  query: TaskLinkRequest,
  db: Database = getDb(),
): Promise<void> {
  requirePermission(actor, "tasks:write");

  await db.transaction(async (tx) => {
    const { self, other } = await lockPair(tx, actor, ref, query.taskId);
    const link = storedLink(self, other, query.type, query.direction);
    const removed = await tx.execute(sql`
      delete from task_links
      where from_task_id = ${link.from.id} and to_task_id = ${link.to.id} and type = ${link.type}
      returning 1`);
    if (removed.length === 0) throw notFound("There is no such link.");
    await recordChange(tx, actor, link, "unlinked", [self, other]);
  });
}
