import { sql } from "drizzle-orm";

import {
  type CreateLabelRequest,
  type Label,
  type LabelColour,
  type LabelList,
  MAX_LABELS_PER_PROJECT,
  type UpdateLabelRequest,
} from "@/lib/schemas/labels";
import { type Actor, requirePermission } from "@/server/auth/actor";
import { type Database, getDb } from "@/server/db/client";
import { hasPostgresCode, UNIQUE_VIOLATION } from "@/server/db/errors";
import { taskEvents } from "@/server/db/schema";
import { labelNameTaken, notFound, tooManyLabels, versionConflict } from "@/server/http/errors";

import { recordAudit } from "./audit";
import { publishEvent, publishEvents } from "./events";
import { findProjectRef, lockWritableProject } from "./projects";

// Labels (doc 0003 section 4, WT-07 decisions 8 to 12, WS-107). Every write locks its
// project exclusively, so label writes in a project run one at a time, and task writes,
// which hold the project's shared lock, never see a label half deleted.

type Executor = Pick<Database, "execute">;

const ISO_MS = sql`'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;

const LABEL_COLUMNS = sql`
  l.id, l.project_id, l.name, l.colour, l.version,
  to_char(l.created_at at time zone 'utc', ${ISO_MS}) as created_at,
  to_char(l.updated_at at time zone 'utc', ${ISO_MS}) as updated_at`;

interface LabelRow extends Record<string, unknown> {
  id: string;
  project_id: string;
  name: string;
  colour: LabelColour;
  version: number;
  created_at: string;
  updated_at: string;
}

function toLabel(row: LabelRow): Label {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    colour: row.colour,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function labelNotFound() {
  return notFound("There is no such label.");
}

function projectNotFound() {
  return notFound("There is no such project.");
}

/** Another label of the project with this name, ignoring case. */
async function nameTaken(
  executor: Executor,
  projectId: string,
  name: string,
  exceptId: string | null,
): Promise<boolean> {
  const [row] = await executor.execute<{ id: string }>(sql`
    select id from labels
    where project_id = ${projectId} and lower(name) = lower(${name})
      ${exceptId === null ? sql`` : sql`and id <> ${exceptId}`}
    limit 1`);
  return row !== undefined;
}

/** The label, with its project locked as writable and exclusively. */
async function lockLabel(executor: Executor, actor: Actor, labelId: string): Promise<LabelRow> {
  const [owner] = await executor.execute<{ project_id: string }>(
    sql`select project_id from labels where id = ${labelId}`,
  );
  if (!owner) throw labelNotFound();
  await lockWritableProject(executor, actor, owner.project_id, "exclusive");
  const [label] = await executor.execute<LabelRow>(
    sql`select ${LABEL_COLUMNS} from labels l where l.id = ${labelId} for update`,
  );
  // Deleted between the first read and the lock.
  if (!label) throw labelNotFound();
  return label;
}

async function publishLabelChanged(
  executor: Executor,
  actor: Actor,
  label: { id: string; project_id: string },
  version: number | null,
): Promise<void> {
  await publishEvent(executor, {
    type: "label.changed",
    entity: "label",
    projectId: label.project_id,
    entityId: label.id,
    version,
    actorAccountId: actor.accountId,
  });
}

/** A duplicate name that slipped past the check is the same answer (the index decides). */
async function namedUniquely<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (hasPostgresCode(error, UNIQUE_VIOLATION)) throw labelNameTaken();
    throw error;
  }
}

export async function listLabels(
  actor: Actor,
  projectRef: string,
  db: Database = getDb(),
): Promise<LabelList> {
  requirePermission(actor, "tasks:read");
  const project = await findProjectRef(db, actor, projectRef);
  if (!project) throw projectNotFound();

  const rows = await db.execute<LabelRow>(sql`
    select ${LABEL_COLUMNS} from labels l
    where l.project_id = ${project.id}
    order by lower(l.name), l.id`);
  return { items: rows.map(toLabel), nextCursor: null };
}

export async function createLabel(
  actor: Actor,
  projectRef: string,
  input: CreateLabelRequest,
  db: Database = getDb(),
): Promise<Label> {
  requirePermission(actor, "labels:write");

  return namedUniquely(() =>
    db.transaction(async (tx) => {
      const project = await lockWritableProject(tx, actor, projectRef, "exclusive");
      if (await nameTaken(tx, project.id, input.name, null)) throw labelNameTaken();
      const [count] = await tx.execute<{ count: number }>(
        sql`select count(*)::int as count from labels where project_id = ${project.id}`,
      );
      if ((count?.count ?? 0) >= MAX_LABELS_PER_PROJECT) throw tooManyLabels();

      const [row] = await tx.execute<LabelRow>(sql`
        insert into labels as l (project_id, name, colour)
        values (${project.id}, ${input.name}, ${input.colour})
        returning ${LABEL_COLUMNS}`);
      if (!row) throw labelNotFound();

      await recordAudit(tx, {
        actor,
        action: "label.created",
        entity: "label",
        entityId: row.id,
        data: { projectId: project.id, name: row.name, colour: row.colour },
      });
      await publishLabelChanged(tx, actor, row, row.version);
      return toLabel(row);
    }),
  );
}

export async function updateLabel(
  actor: Actor,
  labelId: string,
  input: UpdateLabelRequest,
  db: Database = getDb(),
): Promise<Label> {
  requirePermission(actor, "labels:manage");

  return namedUniquely(() =>
    db.transaction(async (tx) => {
      const label = await lockLabel(tx, actor, labelId);
      if (label.version !== input.version) throw versionConflict(toLabel(label));

      const name = input.name ?? label.name;
      const colour = input.colour ?? label.colour;
      if (name !== label.name && (await nameTaken(tx, label.project_id, name, label.id))) {
        throw labelNameTaken();
      }

      const [saved] = await tx.execute<LabelRow>(sql`
        update labels l
        set name = ${name}, colour = ${colour}, version = l.version + 1, updated_at = now()
        where l.id = ${label.id}
        returning ${LABEL_COLUMNS}`);
      if (!saved) throw labelNotFound();

      const changed = [
        ...(name === label.name ? [] : ["name"]),
        ...(colour === label.colour ? [] : ["colour"]),
      ];
      if (changed.length > 0) {
        await recordAudit(tx, {
          actor,
          action: "label.updated",
          entity: "label",
          entityId: label.id,
          data: { projectId: label.project_id, changed },
        });
      }
      await publishLabelChanged(tx, actor, saved, saved.version);
      return toLabel(saved);
    }),
  );
}

interface LabelledTask extends Record<string, unknown> {
  id: string;
  deleted: boolean;
  /** The task's labels before the deletion, as the history writes them: by name. */
  labels: { id: string; name: string }[];
}

/**
 * Deletes a label and takes it off every task that has it, deleted ones too (WS-107 section
 * 6): each such task gets a `field_changed` entry for `labels` and a new `version`, and
 * each live one sends `task.updated`.
 */
export async function deleteLabel(
  actor: Actor,
  labelId: string,
  db: Database = getDb(),
): Promise<void> {
  requirePermission(actor, "labels:manage");

  await db.transaction(async (tx) => {
    const label = await lockLabel(tx, actor, labelId);

    const affected = await tx.execute<LabelledTask>(sql`
      select t.id, t.deleted_at is not null as deleted,
        (select json_agg(json_build_object('id', l.id, 'name', l.name)
                         order by lower(l.name), l.id)
         from task_labels tl join labels l on l.id = tl.label_id
         where tl.task_id = t.id) as labels
      from tasks t
      where t.id in (select task_id from task_labels where label_id = ${label.id})
      order by t.id
      for update of t`);

    const bumped = await tx.execute<{ id: string; version: number; deleted: boolean }>(sql`
      update tasks t set version = t.version + 1, updated_at = now()
      where t.id in (select task_id from task_labels where label_id = ${label.id})
      returning t.id, t.version, t.deleted_at is not null as deleted`);
    await tx.execute(sql`delete from task_labels where label_id = ${label.id}`);
    if (affected.length > 0) {
      await tx.insert(taskEvents).values(
        affected.map((task) => ({
          taskId: task.id,
          actorAccountId: actor.accountId,
          type: "field_changed",
          field: "labels",
          oldValue: task.labels,
          newValue: task.labels.filter((each) => each.id !== label.id),
        })),
      );
    }
    await tx.execute(sql`delete from labels where id = ${label.id}`);

    await recordAudit(tx, {
      actor,
      action: "label.deleted",
      entity: "label",
      entityId: label.id,
      data: { projectId: label.project_id, name: label.name, tasks: affected.length },
    });
    await publishLabelChanged(tx, actor, label, null);
    await publishEvents(
      tx,
      bumped
        .filter((task) => !task.deleted)
        .map((task) => ({
          type: "task.updated" as const,
          entity: "task" as const,
          projectId: label.project_id,
          entityId: task.id,
          version: task.version,
          actorAccountId: actor.accountId,
        })),
    );
  });
}
