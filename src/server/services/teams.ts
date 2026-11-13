import { and, eq, sql } from "drizzle-orm";

import type { PaginationQuery } from "@/lib/schemas/pagination";
import type { AddMemberRequest, Team, TeamNameRequest, TeamPage } from "@/lib/schemas/teams";
import { type Actor, requirePermission } from "@/server/auth/actor";
import { type Database, getDb } from "@/server/db/client";
import { FOREIGN_KEY_VIOLATION, hasPostgresCode, UNIQUE_VIOLATION } from "@/server/db/errors";
import { teamMembers, teams } from "@/server/db/schema";
import {
  accountInactive,
  invalidRequest,
  notFound,
  teamInUse,
  teamNameTaken,
} from "@/server/http/errors";
import { decodeNameCursor, encodeNameCursor } from "@/server/http/pagination";

import { recordAudit } from "./audit";
import { isPerson, type PersonRow, toPerson } from "./people";

type Executor = Pick<Database, "execute">;

const ISO_MS = sql`'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;

function teamNotFound() {
  return notFound("There is no such team.");
}

interface TeamRow extends Record<string, unknown> {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

/** The team with every member, ordered by name; `404` if it does not exist. */
async function readTeam(executor: Executor, teamId: string): Promise<Team> {
  const [team] = await executor.execute<TeamRow>(sql`
    select t.id, t.name,
      to_char(t.created_at at time zone 'utc', ${ISO_MS}) as created_at,
      to_char(t.updated_at at time zone 'utc', ${ISO_MS}) as updated_at
    from teams t where t.id = ${teamId}`);
  if (!team) throw teamNotFound();

  const members = await executor.execute<PersonRow>(sql`
    select a.id, a.name, a.disabled_at is null as active
    from team_members m join accounts a on a.id = m.account_id
    where m.team_id = ${teamId}
    order by lower(a.name) collate "C", a.id`);

  return {
    id: team.id,
    name: team.name,
    members: members.map(toPerson),
    createdAt: team.created_at,
    updatedAt: team.updated_at,
  };
}

/** Locks the team row for the rest of the transaction; `404` if it does not exist. */
async function lockTeam(executor: Executor, teamId: string): Promise<{ name: string }> {
  const [row] = await executor.execute<{ name: string }>(
    sql`select name from teams where id = ${teamId} for update`,
  );
  if (!row) throw teamNotFound();
  return row;
}

interface TeamSummaryRow extends Record<string, unknown> {
  id: string;
  name: string;
  member_count: number;
  created_at: string;
}

export async function listTeams(
  actor: Actor,
  query: PaginationQuery,
  db: Database = getDb(),
): Promise<TeamPage> {
  requirePermission(actor, "projects:read");

  const after =
    query.cursor === undefined
      ? sql``
      : (() => {
          const cursor = decodeNameCursor(query.cursor);
          return sql`where (lower(t.name) collate "C", t.id) > (lower(${cursor.name}::text) collate "C", ${cursor.id}::uuid)`;
        })();

  const rows = await db.execute<TeamSummaryRow>(sql`
    select t.id, t.name,
      (select count(*)::int from team_members m where m.team_id = t.id) as member_count,
      to_char(t.created_at at time zone 'utc', ${ISO_MS}) as created_at
    from teams t ${after}
    order by lower(t.name) collate "C", t.id
    limit ${query.limit + 1}`);

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      id: row.id,
      name: row.name,
      memberCount: row.member_count,
      createdAt: row.created_at,
    })),
    nextCursor:
      rows.length > query.limit && last ? encodeNameCursor({ name: last.name, id: last.id }) : null,
  };
}

export async function getTeam(actor: Actor, teamId: string, db: Database = getDb()): Promise<Team> {
  requirePermission(actor, "projects:read");
  return readTeam(db, teamId);
}

export async function createTeam(
  actor: Actor,
  input: TeamNameRequest,
  db: Database = getDb(),
): Promise<Team> {
  requirePermission(actor, "teams:manage");

  return db.transaction(async (tx) => {
    // No conflict target: the only unique constraints are the id and the name index.
    const [row] = await tx
      .insert(teams)
      .values({ name: input.name, createdBy: actor.accountId })
      .onConflictDoNothing()
      .returning({ id: teams.id });
    if (!row) throw teamNameTaken();

    await recordAudit(tx, {
      actor,
      action: "team.created",
      entity: "team",
      entityId: row.id,
      data: { name: input.name },
    });
    return readTeam(tx, row.id);
  });
}

export async function renameTeam(
  actor: Actor,
  teamId: string,
  input: TeamNameRequest,
  db: Database = getDb(),
): Promise<Team> {
  requirePermission(actor, "teams:manage");

  try {
    return await db.transaction(async (tx) => {
      const { name: from } = await lockTeam(tx, teamId);
      if (from !== input.name) {
        await tx
          .update(teams)
          .set({ name: input.name, updatedAt: sql`now()` })
          .where(eq(teams.id, teamId));
        await recordAudit(tx, {
          actor,
          action: "team.renamed",
          entity: "team",
          entityId: teamId,
          data: { from, to: input.name },
        });
      }
      return readTeam(tx, teamId);
    });
  } catch (error) {
    if (hasPostgresCode(error, UNIQUE_VIOLATION)) throw teamNameTaken();
    throw error;
  }
}

export async function deleteTeam(
  actor: Actor,
  teamId: string,
  db: Database = getDb(),
): Promise<void> {
  requirePermission(actor, "teams:manage");

  try {
    await deleteTeamRow(actor, teamId, db);
  } catch (error) {
    // A task still refers to the team (WS-030).
    if (hasPostgresCode(error, FOREIGN_KEY_VIOLATION)) throw teamInUse();
    throw error;
  }
}

async function deleteTeamRow(actor: Actor, teamId: string, db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    const { name } = await lockTeam(tx, teamId);
    const [counted] = await tx.execute<{ count: number }>(
      sql`select count(*)::int as count from team_members where team_id = ${teamId}`,
    );
    // Memberships go with the team (on delete cascade).
    await tx.delete(teams).where(eq(teams.id, teamId));
    await recordAudit(tx, {
      actor,
      action: "team.deleted",
      entity: "team",
      entityId: teamId,
      data: { name, memberCount: counted?.count ?? 0 },
    });
  });
}

export async function addTeamMember(
  actor: Actor,
  teamId: string,
  input: AddMemberRequest,
  db: Database = getDb(),
): Promise<Team> {
  requirePermission(actor, "teams:manage");

  return db.transaction(async (tx) => {
    await lockTeam(tx, teamId);
    const [person] = await tx.execute<{ active: boolean }>(sql`
      select a.disabled_at is null as active from accounts a
      where a.id = ${input.accountId} and ${isPerson("a")}`);
    if (!person) {
      throw invalidRequest(
        [{ path: "accountId", message: "Not a person who can join a team." }],
        "The request body is not valid.",
      );
    }
    if (!person.active) throw accountInactive();

    const added = await tx
      .insert(teamMembers)
      .values({ teamId, accountId: input.accountId })
      .onConflictDoNothing()
      .returning({ accountId: teamMembers.accountId });
    // Already a member: nothing changed, so nothing to record.
    if (added.length > 0) {
      await recordAudit(tx, {
        actor,
        action: "team.member_added",
        entity: "team",
        entityId: teamId,
        data: { accountId: input.accountId },
      });
    }
    return readTeam(tx, teamId);
  });
}

export async function removeTeamMember(
  actor: Actor,
  teamId: string,
  accountId: string,
  db: Database = getDb(),
): Promise<void> {
  requirePermission(actor, "teams:manage");

  await db.transaction(async (tx) => {
    await lockTeam(tx, teamId);
    const removed = await tx
      .delete(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.accountId, accountId)))
      .returning({ accountId: teamMembers.accountId });
    if (removed.length === 0) throw notFound("This person is not a member of the team.");

    await recordAudit(tx, {
      actor,
      action: "team.member_removed",
      entity: "team",
      entityId: teamId,
      data: { accountId },
    });
  });
}
