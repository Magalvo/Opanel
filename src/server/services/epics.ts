import { sql } from "drizzle-orm";

import type {
  CreateEpicRequest,
  Epic,
  EpicPage,
  EpicQuery,
  EpicStatus,
  UpdateEpicRequest,
} from "@/lib/schemas/epics";
import { type Actor, requirePermission, requireProjectAccess } from "@/server/auth/actor";
import { type Database, getDb } from "@/server/db/client";
import { epics } from "@/server/db/schema";
import { invalidRequest, notFound, versionConflict } from "@/server/http/errors";
import { decodeNameCursor, encodeNameCursor } from "@/server/http/pagination";

import { recordAudit } from "./audit";
import { publishEvent } from "./events";
import { findProjectRef, lockWritableProject } from "./projects";

type Executor = Pick<Database, "execute">;

const ISO_MS = sql`'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;

/** Every column of an epic's API shape, with its progress (WT-03 decision 18). */
const EPIC_SELECT = sql`
  select e.id, e.project_id, e.title, e.description, e.status,
    to_char(e.start_date, 'YYYY-MM-DD') as start_date,
    to_char(e.target_date, 'YYYY-MM-DD') as target_date,
    e.version,
    to_char(e.created_at at time zone 'utc', ${ISO_MS}) as created_at,
    to_char(e.updated_at at time zone 'utc', ${ISO_MS}) as updated_at,
    ep.total_tasks, ep.done_tasks, ep.total_points, ep.done_points, ep.unestimated
  from epics e
  -- The epic's live tasks, read once (WS-139 section 4); sub-tasks count as stored.
  cross join lateral (
    select count(*)::int as total_tasks,
      (count(*) filter (where c.category = 'done'))::int as done_tasks,
      coalesce(sum(t.story_points), 0)::float8 as total_points,
      coalesce(sum(t.story_points) filter (where c.category = 'done'), 0)::float8 as done_points,
      (count(*) filter (where t.story_points is null))::int as unestimated
    from tasks t left join columns c on c.id = t.column_id
    where t.epic_id = e.id and t.deleted_at is null
  ) ep`;

interface EpicRow extends Record<string, unknown> {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: EpicStatus;
  start_date: string | null;
  target_date: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  total_tasks: number;
  done_tasks: number;
  total_points: number;
  done_points: number;
  unestimated: number;
}

function toEpic(row: EpicRow): Epic {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status,
    startDate: row.start_date,
    targetDate: row.target_date,
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

function epicNotFound() {
  return notFound("There is no such epic.");
}

async function findEpic(executor: Executor, epicId: string): Promise<EpicRow | undefined> {
  const [row] = await executor.execute<EpicRow>(sql`${EPIC_SELECT} where e.id = ${epicId}`);
  return row;
}

export async function listEpics(
  actor: Actor,
  projectRef: string,
  query: EpicQuery,
  db: Database = getDb(),
): Promise<EpicPage> {
  requirePermission(actor, "tasks:read");
  const project = await findProjectRef(db, actor, projectRef);
  if (!project) throw notFound("There is no such project.");

  const status = query.status ?? "open";
  const ofStatus = status === "all" ? sql`` : sql`and e.status = ${status}`;
  const after =
    query.cursor === undefined
      ? sql``
      : (() => {
          const cursor = decodeNameCursor(query.cursor);
          return sql`and (lower(e.title) collate "C", e.id) >
            (lower(${cursor.name}::text) collate "C", ${cursor.id}::uuid)`;
        })();

  const rows = await db.execute<EpicRow>(sql`
    ${EPIC_SELECT}
    where e.project_id = ${project.id} ${ofStatus} ${after}
    order by lower(e.title) collate "C", e.id
    limit ${query.limit + 1}`);

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(toEpic),
    nextCursor:
      rows.length > query.limit && last
        ? encodeNameCursor({ name: last.title, id: last.id })
        : null,
  };
}

export async function getEpic(actor: Actor, epicId: string, db: Database = getDb()): Promise<Epic> {
  requirePermission(actor, "tasks:read");
  const row = await findEpic(db, epicId);
  if (!row) throw epicNotFound();
  requireProjectAccess(actor, row.project_id);
  return toEpic(row);
}

/** Announces a change to an epic, with its version after the write (WS-045). */
async function publishEpicChanged(
  executor: Pick<Database, "execute">,
  actor: Actor,
  epic: { id: string; project_id: string; version: number },
): Promise<void> {
  await publishEvent(executor, {
    type: "epic.changed",
    entity: "epic",
    projectId: epic.project_id,
    entityId: epic.id,
    version: epic.version,
    actorAccountId: actor.accountId,
  });
}

export async function createEpic(
  actor: Actor,
  projectRef: string,
  input: CreateEpicRequest,
  db: Database = getDb(),
): Promise<Epic> {
  requirePermission(actor, "epics:manage");

  return db.transaction(async (tx) => {
    const project = await lockWritableProject(tx, actor, projectRef);
    const [row] = await tx
      .insert(epics)
      .values({
        projectId: project.id,
        title: input.title,
        description: input.description ?? "",
        startDate: input.startDate ?? null,
        targetDate: input.targetDate ?? null,
        createdBy: actor.accountId,
      })
      .returning({ id: epics.id });
    if (!row) throw epicNotFound();

    await recordAudit(tx, {
      actor,
      action: "epic.created",
      entity: "epic",
      entityId: row.id,
      data: { projectId: project.id, title: input.title },
    });

    const created = await findEpic(tx, row.id);
    if (!created) throw epicNotFound();
    await publishEpicChanged(tx, actor, created);
    return toEpic(created);
  });
}

/** The fields whose change writes `epic.updated`, in the order they are listed. */
const EDITABLE = [
  ["title", "title"],
  ["description", "description"],
  ["startDate", "start_date"],
  ["targetDate", "target_date"],
] as const;

export async function updateEpic(
  actor: Actor,
  epicId: string,
  input: UpdateEpicRequest,
  db: Database = getDb(),
): Promise<Epic> {
  requirePermission(actor, "epics:manage");

  return db.transaction(async (tx) => {
    const [owner] = await tx.execute<{ project_id: string }>(
      sql`select project_id from epics where id = ${epicId}`,
    );
    if (!owner) throw epicNotFound();
    await lockWritableProject(tx, actor, owner.project_id);
    await tx.execute(sql`select 1 from epics where id = ${epicId} for update`);
    const before = await findEpic(tx, epicId);
    if (!before) throw epicNotFound();
    if (before.version !== input.version) throw versionConflict(toEpic(before));

    const after = {
      title: input.title ?? before.title,
      description: input.description ?? before.description,
      status: input.status ?? before.status,
      startDate: input.startDate === undefined ? before.start_date : input.startDate,
      targetDate: input.targetDate === undefined ? before.target_date : input.targetDate,
    };
    // The pair is checked as it will be, which a request alone cannot see (WS-033 section 2).
    if (
      after.startDate !== null &&
      after.targetDate !== null &&
      after.targetDate < after.startDate
    ) {
      throw invalidRequest(
        [{ path: "targetDate", message: "The target date may not be before the start date." }],
        "The request body is not valid.",
      );
    }

    await tx.execute(sql`
      update epics set title = ${after.title}, description = ${after.description},
        status = ${after.status}, start_date = ${after.startDate}, target_date = ${after.targetDate},
        version = version + 1, updated_at = now()
      where id = ${epicId}`);

    const changed = EDITABLE.filter(([field, column]) => after[field] !== before[column]).map(
      ([field]) => field,
    );
    if (changed.length > 0) {
      await recordAudit(tx, {
        actor,
        action: "epic.updated",
        entity: "epic",
        entityId: epicId,
        data: { projectId: before.project_id, changed },
      });
    }
    if (after.status !== before.status) {
      await recordAudit(tx, {
        actor,
        action: after.status === "closed" ? "epic.closed" : "epic.reopened",
        entity: "epic",
        entityId: epicId,
        data: { projectId: before.project_id },
      });
    }

    const updated = await findEpic(tx, epicId);
    if (!updated) throw epicNotFound();
    await publishEpicChanged(tx, actor, updated);
    return toEpic(updated);
  });
}
