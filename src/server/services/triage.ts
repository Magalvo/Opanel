import { sql } from "drizzle-orm";

import { ROUTED_LAYERS, type RoutedLayer } from "@/lib/schemas/bug-reports";
import type { FieldError } from "@/lib/schemas/problem";
import type { TriageSettings, UpdateTriageRequest } from "@/lib/schemas/triage";
import { type Actor, requirePermission } from "@/server/auth/actor";
import { type Database, getDb } from "@/server/db/client";
import { invalidRequest, notFound, projectArchived, versionConflict } from "@/server/http/errors";

import { recordAudit } from "./audit";
import { findProjectRef, publishProjectChanged } from "./projects";

// A project's triage settings (canonical doc 0001 section 6, WT-06 decisions 4 and 5,
// WS-087): its triage team and the team of each routed layer. They share the project's
// version, which a change bumps.

type Executor = Pick<Database, "execute">;

function projectNotFound() {
  return notFound("There is no such project.");
}

/** The settings of a project, by id. */
async function readSettings(executor: Executor, projectId: string): Promise<TriageSettings> {
  const [project] = await executor.execute<{ triageTeamId: string | null; version: number }>(
    sql`select triage_team_id as "triageTeamId", version from projects where id = ${projectId}`,
  );
  if (!project) throw projectNotFound();
  const rows = await executor.execute<{ layer: RoutedLayer; teamId: string }>(
    sql`select origin_layer as layer, team_id as "teamId" from routing_rules
        where project_id = ${projectId}`,
  );
  const rules = { frontend: null, api: null, backend: null } as Record<RoutedLayer, string | null>;
  for (const row of rows) rules[row.layer] = row.teamId;
  return { triageTeamId: project.triageTeamId, rules, version: project.version };
}

export async function getTriage(
  actor: Actor,
  projectRef: string,
  db: Database = getDb(),
): Promise<TriageSettings> {
  requirePermission(actor, "projects:read");
  const project = await findProjectRef(db, actor, projectRef);
  if (!project) throw projectNotFound();
  return readSettings(db, project.id);
}

/** Every team the change names, by the field that names it. */
function namedTeams(input: UpdateTriageRequest): [string, string][] {
  const named: [string, string][] = [];
  if (input.triageTeamId) named.push(["triageTeamId", input.triageTeamId]);
  for (const layer of ROUTED_LAYERS) {
    const teamId = input.rules?.[layer];
    if (teamId) named.push([`rules.${layer}`, teamId]);
  }
  return named;
}

/** `400` naming each field whose team does not exist. */
async function assertTeams(executor: Executor, input: UpdateTriageRequest): Promise<void> {
  const named = namedTeams(input);
  if (named.length === 0) return;
  const rows = await executor.execute<{ id: string }>(
    sql`select id from teams where id in (${sql.join(
      named.map(([, id]) => sql`${id}::uuid`),
      sql`, `,
    )})`,
  );
  const known = new Set(rows.map((row) => row.id));
  const errors: FieldError[] = named
    .filter(([, id]) => !known.has(id))
    .map(([path]) => ({ path, message: "There is no such team." }));
  if (errors.length > 0) throw invalidRequest(errors);
}

/** The fields whose team changed, with the old and the new one (for the audit log). */
function changes(
  before: TriageSettings,
  after: TriageSettings,
): Record<string, { from: string | null; to: string | null }> {
  const changed: Record<string, { from: string | null; to: string | null }> = {};
  if (before.triageTeamId !== after.triageTeamId) {
    changed.triageTeamId = { from: before.triageTeamId, to: after.triageTeamId };
  }
  for (const layer of ROUTED_LAYERS) {
    if (before.rules[layer] !== after.rules[layer]) {
      changed[`rules.${layer}`] = { from: before.rules[layer], to: after.rules[layer] };
    }
  }
  return changed;
}

export async function updateTriage(
  actor: Actor,
  projectRef: string,
  input: UpdateTriageRequest,
  db: Database = getDb(),
): Promise<TriageSettings> {
  requirePermission(actor, "teams:manage");

  return db.transaction(async (tx) => {
    const project = await findProjectRef(tx, actor, projectRef);
    if (!project) throw projectNotFound();
    await assertTeams(tx, input);
    const before = await readSettings(tx, project.id);

    const triageTeam =
      input.triageTeamId === undefined ? sql`triage_team_id` : sql`${input.triageTeamId}::uuid`;
    const [updated] = await tx.execute<{ id: string; version: number }>(sql`
      update projects
      set triage_team_id = ${triageTeam}, version = version + 1, updated_at = now()
      where id = ${project.id} and version = ${input.version} and archived_at is null
      returning id, version`);
    if (!updated) {
      const [current] = await tx.execute<{ archived: boolean }>(
        sql`select archived_at is not null as archived from projects where id = ${project.id}`,
      );
      if (!current) throw projectNotFound();
      if (current.archived) throw projectArchived();
      throw versionConflict(before);
    }

    for (const layer of ROUTED_LAYERS) {
      const teamId = input.rules?.[layer];
      if (teamId === undefined) continue;
      await tx.execute(
        teamId === null
          ? sql`delete from routing_rules where project_id = ${project.id} and origin_layer = ${layer}`
          : sql`insert into routing_rules (project_id, origin_layer, team_id)
                values (${project.id}, ${layer}, ${teamId})
                on conflict (project_id, origin_layer) do update set team_id = excluded.team_id`,
      );
    }

    const after = await readSettings(tx, project.id);
    const changed = changes(before, after);
    if (Object.keys(changed).length > 0) {
      await recordAudit(tx, {
        actor,
        action: "project.triage_updated",
        entity: "project",
        entityId: project.id,
        data: { changed },
      });
    }
    await publishProjectChanged(tx, actor, updated);
    return after;
  });
}
