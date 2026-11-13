import { type SQL, sql } from "drizzle-orm";

import { positionsBetween } from "@/lib/position";
import type {
  CreateProjectRequest,
  Project,
  ProjectPage,
  ProjectQuery,
  UpdateProjectRequest,
} from "@/lib/schemas/projects";
import { type Actor, requirePermission } from "@/server/auth/actor";
import { type Database, getDb } from "@/server/db/client";
import { columns, projects } from "@/server/db/schema";
import { notFound, projectArchived, projectKeyTaken, versionConflict } from "@/server/http/errors";
import { decodeNameCursor, encodeNameCursor } from "@/server/http/pagination";

import { recordAudit } from "./audit";

type Executor = Pick<Database, "execute">;

const ISO_MS = sql`'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The columns a new project starts with (canonical doc 0003 section 5, WT-03 decision 10). */
const DEFAULT_COLUMNS = [
  { name: "To do", category: "todo" },
  { name: "In progress", category: "in_progress" },
  { name: "Done", category: "done" },
] as const;

const PROJECT_COLUMNS = sql`
  p.id, p.key, p.name, p.description, p.version,
  to_char(p.archived_at at time zone 'utc', ${ISO_MS}) as archived_at,
  to_char(p.created_at at time zone 'utc', ${ISO_MS}) as created_at,
  to_char(p.updated_at at time zone 'utc', ${ISO_MS}) as updated_at`;

interface ProjectRow extends Record<string, unknown> {
  id: string;
  key: string;
  name: string;
  description: string;
  version: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    archivedAt: row.archived_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** `p.id = ...` for a UUID, `p.key = ...` for a key (WS-028 section 3). */
function matches(ref: string): SQL {
  return UUID.test(ref) ? sql`p.id = ${ref}::uuid` : sql`p.key = ${ref}`;
}

function projectNotFound() {
  return notFound("There is no such project.");
}

async function findProject(
  executor: Executor,
  ref: string,
  lock: SQL = sql``,
): Promise<Project | undefined> {
  const [row] = await executor.execute<ProjectRow>(
    sql`select ${PROJECT_COLUMNS} from projects p where ${matches(ref)} ${lock}`,
  );
  return row === undefined ? undefined : toProject(row);
}

/**
 * For every write inside a project (WS-028 section 5): resolves the project by id or key,
 * locks its row until the transaction ends, so it cannot be archived in between, and refuses
 * an unknown (`404`) or archived (`409 project_archived`) project.
 *
 * `shared` (the default, `for share`) lets writes run side by side. `exclusive` (`for no key
 * update`) makes writes that change the project's structure, such as its columns, run one at
 * a time; a statement that runs after the lock is granted sees what the previous holder
 * committed (WS-029). Neither blocks inserts that only reference the project.
 */
export async function lockWritableProject(
  executor: Executor,
  ref: string,
  mode: "shared" | "exclusive" = "shared",
): Promise<{ id: string; key: string }> {
  const lock = mode === "exclusive" ? sql`for no key update` : sql`for share`;
  const project = await findProject(executor, ref, lock);
  if (!project) throw projectNotFound();
  if (project.archivedAt !== null) throw projectArchived();
  return { id: project.id, key: project.key };
}

export async function listProjects(
  actor: Actor,
  query: ProjectQuery,
  db: Database = getDb(),
): Promise<ProjectPage> {
  requirePermission(actor, "projects:read");

  const archived =
    query.archived === "true" ? sql`p.archived_at is not null` : sql`p.archived_at is null`;
  const after =
    query.cursor === undefined
      ? sql``
      : (() => {
          const cursor = decodeNameCursor(query.cursor);
          return sql`and (lower(p.name) collate "C", p.id) > (lower(${cursor.name}::text) collate "C", ${cursor.id}::uuid)`;
        })();

  const rows = await db.execute<ProjectRow>(sql`
    select ${PROJECT_COLUMNS} from projects p
    where ${archived} ${after}
    order by lower(p.name) collate "C", p.id
    limit ${query.limit + 1}`);

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(toProject),
    nextCursor:
      rows.length > query.limit && last ? encodeNameCursor({ name: last.name, id: last.id }) : null,
  };
}

export async function getProject(
  actor: Actor,
  ref: string,
  db: Database = getDb(),
): Promise<Project> {
  requirePermission(actor, "projects:read");
  const project = await findProject(db, ref);
  if (!project) throw projectNotFound();
  return project;
}

export async function createProject(
  actor: Actor,
  input: CreateProjectRequest,
  db: Database = getDb(),
): Promise<Project> {
  requirePermission(actor, "projects:manage");

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(projects)
      .values({
        key: input.key,
        name: input.name,
        description: input.description ?? "",
        createdBy: actor.accountId,
      })
      .onConflictDoNothing({ target: projects.key })
      .returning({ id: projects.id });
    if (!row) throw projectKeyTaken();

    const positions = positionsBetween(null, null, DEFAULT_COLUMNS.length);
    await tx.insert(columns).values(
      DEFAULT_COLUMNS.map((column, index) => ({
        projectId: row.id,
        name: column.name,
        category: column.category,
        position: positions[index] ?? "",
      })),
    );

    await recordAudit(tx, {
      actor,
      action: "project.created",
      entity: "project",
      entityId: row.id,
      data: { key: input.key, name: input.name },
    });

    const project = await findProject(tx, row.id);
    if (!project) throw projectNotFound();
    return project;
  });
}

export async function updateProject(
  actor: Actor,
  ref: string,
  input: UpdateProjectRequest,
  db: Database = getDb(),
): Promise<Project> {
  requirePermission(actor, "projects:manage");

  return db.transaction(async (tx) => {
    const before = await findProject(tx, ref);
    if (!before) throw projectNotFound();

    const name = input.name ?? before.name;
    const description = input.description ?? before.description;
    const [updated] = await tx.execute<ProjectRow>(sql`
      update projects p
      set name = ${name}, description = ${description},
          version = p.version + 1, updated_at = now()
      where p.id = ${before.id} and p.version = ${input.version} and p.archived_at is null
      returning ${PROJECT_COLUMNS}`);

    if (!updated) {
      const current = await findProject(tx, before.id);
      if (!current) throw projectNotFound();
      if (current.archivedAt !== null) throw projectArchived();
      throw versionConflict(current);
    }

    const changed = [
      ...(name === before.name ? [] : ["name"]),
      ...(description === before.description ? [] : ["description"]),
    ];
    if (changed.length > 0) {
      await recordAudit(tx, {
        actor,
        action: "project.updated",
        entity: "project",
        entityId: before.id,
        data: { changed },
      });
    }
    return toProject(updated);
  });
}

/** Archives (`archived` true) or unarchives a project. Idempotent: no change, no audit entry. */
async function setArchived(
  actor: Actor,
  ref: string,
  archived: boolean,
  db: Database,
): Promise<Project> {
  requirePermission(actor, "projects:manage");

  return db.transaction(async (tx) => {
    // `for update` waits for writes in flight, which hold `for share` (lockWritableProject).
    const project = await findProject(tx, ref, sql`for update`);
    if (!project) throw projectNotFound();
    if ((project.archivedAt !== null) === archived) return project;

    const [updated] = await tx.execute<ProjectRow>(sql`
      update projects p
      set archived_at = ${archived ? sql`now()` : sql`null`},
          version = p.version + 1, updated_at = now()
      where p.id = ${project.id}
      returning ${PROJECT_COLUMNS}`);
    if (!updated) throw projectNotFound();

    await recordAudit(tx, {
      actor,
      action: archived ? "project.archived" : "project.unarchived",
      entity: "project",
      entityId: project.id,
      data: { key: project.key },
    });
    return toProject(updated);
  });
}

export async function archiveProject(
  actor: Actor,
  ref: string,
  db: Database = getDb(),
): Promise<Project> {
  return setArchived(actor, ref, true, db);
}

export async function unarchiveProject(
  actor: Actor,
  ref: string,
  db: Database = getDb(),
): Promise<Project> {
  return setArchived(actor, ref, false, db);
}
