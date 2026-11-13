import { eq, sql } from "drizzle-orm";

import { positionBetween } from "@/lib/position";
import type {
  Column,
  ColumnCategory,
  ColumnList,
  CreateColumnRequest,
  MoveColumnRequest,
  UpdateColumnRequest,
} from "@/lib/schemas/columns";
import { type Actor, requirePermission } from "@/server/auth/actor";
import { type Database, getDb } from "@/server/db/client";
import { FOREIGN_KEY_VIOLATION, hasPostgresCode } from "@/server/db/errors";
import { columns } from "@/server/db/schema";
import {
  columnNotEmpty,
  invalidRequest,
  lastDoneColumn,
  notFound,
  versionConflict,
} from "@/server/http/errors";

import { recordAudit } from "./audit";
import { getProject, lockWritableProject } from "./projects";

type Executor = Pick<Database, "execute">;

const ISO_MS = sql`'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;

const COLUMN_COLUMNS = sql`
  c.id, c.project_id, c.name, c.category, c.position, c.version,
  to_char(c.created_at at time zone 'utc', ${ISO_MS}) as created_at,
  to_char(c.updated_at at time zone 'utc', ${ISO_MS}) as updated_at`;

interface ColumnRow extends Record<string, unknown> {
  id: string;
  project_id: string;
  name: string;
  category: ColumnCategory;
  position: string;
  version: number;
  created_at: string;
  updated_at: string;
}

/** The API shape: the ordering key stays internal (WS-029 section 2). */
function toColumn(row: ColumnRow): Column {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    category: row.category,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function columnNotFound() {
  return notFound("There is no such column.");
}

function invalidAnchor() {
  return invalidRequest(
    [{ path: "afterColumnId", message: "Not another column of this project." }],
    "The request body is not valid.",
  );
}

/**
 * Every column of the project in board order, locked until the transaction ends. Call it
 * after `lockWritableProject(..., "exclusive")`: that lock is what makes column changes in
 * one project run one at a time; a row lock alone would not show this statement a column
 * that another transaction inserted while it waited (WS-029, implementation record).
 * Positions compare byte by byte (`collate "C"`, amendment A2).
 */
async function lockColumns(executor: Executor, projectId: string): Promise<ColumnRow[]> {
  return executor.execute<ColumnRow>(sql`
    select ${COLUMN_COLUMNS} from columns c
    where c.project_id = ${projectId}
    order by c.position
    for update`);
}

/** The column, its project locked as writable, and all of the project's columns locked. */
async function lockForColumn(
  executor: Executor,
  columnId: string,
): Promise<{ column: ColumnRow; all: ColumnRow[] }> {
  const [owner] = await executor.execute<{ project_id: string }>(
    sql`select project_id from columns where id = ${columnId}`,
  );
  if (!owner) throw columnNotFound();
  await lockWritableProject(executor, owner.project_id, "exclusive");
  const all = await lockColumns(executor, owner.project_id);
  const column = all.find((row) => row.id === columnId);
  // Deleted between the first read and the lock.
  if (!column) throw columnNotFound();
  return { column, all };
}

function isLastDone(column: ColumnRow, all: readonly ColumnRow[]): boolean {
  return column.category === "done" && all.filter((row) => row.category === "done").length === 1;
}

export async function listColumns(
  actor: Actor,
  projectRef: string,
  db: Database = getDb(),
): Promise<ColumnList> {
  requirePermission(actor, "projects:read");
  const project = await getProject(actor, projectRef, db);

  const rows = await db.execute<ColumnRow>(sql`
    select ${COLUMN_COLUMNS} from columns c
    where c.project_id = ${project.id}
    order by c.position`);
  return { items: rows.map(toColumn), nextCursor: null };
}

export async function createColumn(
  actor: Actor,
  projectRef: string,
  input: CreateColumnRequest,
  db: Database = getDb(),
): Promise<Column> {
  requirePermission(actor, "projects:manage");

  return db.transaction(async (tx) => {
    const project = await lockWritableProject(tx, projectRef, "exclusive");
    const all = await lockColumns(tx, project.id);

    let after: ColumnRow | null;
    let next: ColumnRow | null;
    if (input.afterColumnId === undefined) {
      after = all.at(-1) ?? null;
      next = null;
    } else if (input.afterColumnId === null) {
      after = null;
      next = all[0] ?? null;
    } else {
      const index = all.findIndex((row) => row.id === input.afterColumnId);
      if (index === -1) throw invalidAnchor();
      after = all[index] ?? null;
      next = all[index + 1] ?? null;
    }

    const [row] = await tx
      .insert(columns)
      .values({
        projectId: project.id,
        name: input.name,
        category: input.category,
        position: positionBetween(after?.position ?? null, next?.position ?? null),
      })
      .returning({ id: columns.id });
    if (!row) throw columnNotFound();

    await recordAudit(tx, {
      actor,
      action: "column.created",
      entity: "column",
      entityId: row.id,
      data: { projectId: project.id, name: input.name, category: input.category },
    });

    const [created] = await tx.execute<ColumnRow>(
      sql`select ${COLUMN_COLUMNS} from columns c where c.id = ${row.id}`,
    );
    if (!created) throw columnNotFound();
    return toColumn(created);
  });
}

/** Writes the change and bumps `version`; the row is locked, so the version is current. */
async function saveColumn(
  executor: Executor,
  columnId: string,
  change: { name: string; category: ColumnCategory; position: string },
): Promise<ColumnRow> {
  const [row] = await executor.execute<ColumnRow>(sql`
    update columns c
    set name = ${change.name}, category = ${change.category}, position = ${change.position},
        version = c.version + 1, updated_at = now()
    where c.id = ${columnId}
    returning ${COLUMN_COLUMNS}`);
  if (!row) throw columnNotFound();
  return row;
}

export async function updateColumn(
  actor: Actor,
  columnId: string,
  input: UpdateColumnRequest,
  db: Database = getDb(),
): Promise<Column> {
  requirePermission(actor, "projects:manage");

  return db.transaction(async (tx) => {
    const { column, all } = await lockForColumn(tx, columnId);
    if (column.version !== input.version) throw versionConflict(toColumn(column));

    const name = input.name ?? column.name;
    const category = input.category ?? column.category;
    if (category !== "done" && isLastDone(column, all)) throw lastDoneColumn();

    const saved = await saveColumn(tx, column.id, { name, category, position: column.position });
    const changed = [
      ...(name === column.name ? [] : ["name"]),
      ...(category === column.category ? [] : ["category"]),
    ];
    if (changed.length > 0) {
      await recordAudit(tx, {
        actor,
        action: "column.updated",
        entity: "column",
        entityId: column.id,
        data: { projectId: column.project_id, changed },
      });
    }
    return toColumn(saved);
  });
}

export async function moveColumn(
  actor: Actor,
  columnId: string,
  input: MoveColumnRequest,
  db: Database = getDb(),
): Promise<Column> {
  requirePermission(actor, "projects:manage");

  return db.transaction(async (tx) => {
    const { column, all } = await lockForColumn(tx, columnId);
    if (input.afterColumnId === column.id) throw invalidAnchor();
    if (column.version !== input.version) throw versionConflict(toColumn(column));

    const others = all.filter((row) => row.id !== column.id);
    let after: ColumnRow | null = null;
    let next: ColumnRow | null = others[0] ?? null;
    if (input.afterColumnId !== null) {
      const index = others.findIndex((row) => row.id === input.afterColumnId);
      if (index === -1) throw invalidAnchor();
      after = others[index] ?? null;
      next = others[index + 1] ?? null;
    }

    const currentIndex = all.findIndex((row) => row.id === column.id);
    const previous = all[currentIndex - 1] ?? null;
    const unmoved = (previous?.id ?? null) === (after?.id ?? null);
    const position = unmoved
      ? column.position
      : positionBetween(after?.position ?? null, next?.position ?? null);

    const saved = await saveColumn(tx, column.id, {
      name: column.name,
      category: column.category,
      position,
    });
    if (!unmoved) {
      await recordAudit(tx, {
        actor,
        action: "column.moved",
        entity: "column",
        entityId: column.id,
        data: { projectId: column.project_id },
      });
    }
    return toColumn(saved);
  });
}

export async function deleteColumn(
  actor: Actor,
  columnId: string,
  db: Database = getDb(),
): Promise<void> {
  requirePermission(actor, "projects:manage");

  try {
    await deleteColumnRow(actor, columnId, db);
  } catch (error) {
    // A task is still in the column (WS-030).
    if (hasPostgresCode(error, FOREIGN_KEY_VIOLATION)) throw columnNotEmpty();
    throw error;
  }
}

async function deleteColumnRow(actor: Actor, columnId: string, db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    const { column, all } = await lockForColumn(tx, columnId);
    if (isLastDone(column, all)) throw lastDoneColumn();

    await tx.delete(columns).where(eq(columns.id, column.id));
    await recordAudit(tx, {
      actor,
      action: "column.deleted",
      entity: "column",
      entityId: column.id,
      data: { projectId: column.project_id, name: column.name, category: column.category },
    });
  });
}
