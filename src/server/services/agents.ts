import { sql } from "drizzle-orm";

import {
  type Agent,
  type AgentPage,
  type ApiToken,
  type ApiTokenList,
  type CreateAgentRequest,
  type CreateApiTokenRequest,
  type CreatedApiToken,
  scopesOfRole,
  type UpdateAgentRequest,
} from "@/lib/schemas/agents";
import type { PaginationQuery } from "@/lib/schemas/pagination";
import { agentRoleSchema, type AgentScope, agentScopeSchema } from "@/lib/schemas/permissions";
import { type Actor, type AgentActor, agentActor, requirePermission } from "@/server/auth/actor";
import { generateApiToken } from "@/server/auth/api-token";
import { type Database, getDb } from "@/server/db/client";
import { hasPostgresCode, UNIQUE_VIOLATION } from "@/server/db/errors";
import {
  agentDisabled,
  agentNameTaken,
  invalidRequest,
  notFound,
  tooManyTokens,
} from "@/server/http/errors";
import { decodeNameCursor, encodeNameCursor } from "@/server/http/pagination";

import { recordAudit } from "./audit";

interface AgentRow extends Record<string, unknown> {
  id: string;
  role: string;
  all_projects: boolean;
  disabled_at: string | null;
  scopes: string[];
  project_ids: string[];
}

/**
 * An agent's actor, built from its stored role, scopes and projects in one query (WS-071),
 * with when it was disabled, or `null` for a human or an unknown id. Whether a disabled
 * agent may act is for `authenticate()` to decide, as for humans.
 */
export async function loadAgentActor(
  executor: Pick<Database, "execute">,
  accountId: string,
): Promise<{ actor: AgentActor; disabledAt: Date | null } | null> {
  const rows = await executor.execute<AgentRow>(sql`
    select a.id, a.role, a.all_projects, a.disabled_at,
      coalesce((select array_agg(s.scope order by s.scope)
        from agent_scopes s where s.account_id = a.id), '{}') as scopes,
      coalesce((select array_agg(p.project_id order by p.project_id)
        from agent_projects p where p.account_id = a.id), '{}') as project_ids
    from accounts a
    where a.id = ${accountId} and a.kind = 'agent'`);
  const row = rows[0];
  if (!row) return null;

  return {
    actor: agentActor({
      accountId: row.id,
      role: row.role,
      scopes: row.scopes,
      projectIds: row.all_projects ? null : row.project_ids,
    }),
    disabledAt: row.disabled_at === null ? null : new Date(row.disabled_at),
  };
}

// The Admin API for agents and their tokens (WS-075 section 4). Every function checks
// `agents:manage`; every change runs in one transaction with its audit entry.

const ISO_MS = sql`'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const MAX_USABLE_TOKENS = 10;

type Executor = Pick<Database, "execute">;

interface ManagedAgentRow extends Record<string, unknown> {
  id: string;
  name: string;
  description: string | null;
  role: string;
  all_projects: boolean;
  disabled: boolean;
  scopes: string[];
  project_ids: string[];
  created_at: string;
  last_seen_at: string | null;
}

const AGENT_COLUMNS = sql`
  a.id, a.name, a.description, a.role, a.all_projects, a.disabled_at is not null as disabled,
  coalesce((select array_agg(s.scope order by s.scope)
    from agent_scopes s where s.account_id = a.id), '{}') as scopes,
  coalesce((select array_agg(p.project_id::text order by p.project_id)
    from agent_projects p where p.account_id = a.id), '{}') as project_ids,
  to_char(a.created_at at time zone 'utc', ${ISO_MS}) as created_at,
  to_char(a.last_seen_at at time zone 'utc', ${ISO_MS}) as last_seen_at`;

function toAgent(row: ManagedAgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    role: agentRoleSchema.parse(row.role),
    scopes: row.scopes.map((scope) => agentScopeSchema.parse(scope)),
    projectIds: row.all_projects ? null : row.project_ids,
    status: row.disabled ? "disabled" : "active",
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

async function findAgent(db: Executor, id: string, lock = false): Promise<Agent> {
  const rows = await db.execute<ManagedAgentRow>(sql`
    select ${AGENT_COLUMNS} from accounts a
    where a.id = ${id} and a.kind = 'agent' ${lock ? sql`for update of a` : sql``}`);
  const row = rows[0];
  if (!row) throw notFound("There is no such agent.");
  return toAgent(row);
}

/** `400` with the field error `projectIds` when a listed project does not exist. */
async function assertProjectsExist(db: Executor, projectIds: readonly string[]): Promise<void> {
  if (projectIds.length === 0) return;
  const ids = sql.join(
    projectIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const [row] = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from projects where id in (${ids})`,
  );
  if ((row?.count ?? 0) !== projectIds.length) {
    throw invalidRequest([{ path: "projectIds", message: "Names a project that does not exist." }]);
  }
}

async function writeScopesAndProjects(
  db: Executor,
  id: string,
  scopes: readonly AgentScope[],
  projectIds: readonly string[] | null,
): Promise<void> {
  await db.execute(sql`delete from agent_scopes where account_id = ${id}`);
  for (const scope of scopes) {
    await db.execute(sql`insert into agent_scopes (account_id, scope) values (${id}, ${scope})`);
  }
  await db.execute(sql`delete from agent_projects where account_id = ${id}`);
  await db.execute(sql`update accounts set all_projects = ${projectIds === null} where id = ${id}`);
  for (const projectId of projectIds ?? []) {
    await db.execute(
      sql`insert into agent_projects (account_id, project_id) values (${id}, ${projectId})`,
    );
  }
}

/** Scopes as the role allows them, or `400 scopes`. */
function checkScopes(role: Agent["role"], scopes: readonly AgentScope[]): void {
  const allowed = scopesOfRole(role);
  const outside = scopes.filter((scope) => !allowed.includes(scope));
  if (outside.length > 0) {
    throw invalidRequest([
      { path: "scopes", message: `Not part of the role ${role}: ${outside.join(", ")}.` },
    ]);
  }
}

export async function listAgents(
  actor: Actor,
  query: PaginationQuery,
  db: Database = getDb(),
): Promise<AgentPage> {
  requirePermission(actor, "agents:manage");
  const after =
    query.cursor === undefined
      ? sql``
      : (() => {
          const cursor = decodeNameCursor(query.cursor);
          return sql`and (lower(a.name) collate "C", a.id) > (lower(${cursor.name}::text) collate "C", ${cursor.id}::uuid)`;
        })();
  const rows = await db.execute<ManagedAgentRow>(sql`
    select ${AGENT_COLUMNS} from accounts a
    where a.kind = 'agent' ${after}
    order by lower(a.name) collate "C", a.id
    limit ${query.limit + 1}`);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(toAgent),
    nextCursor:
      rows.length > query.limit && last ? encodeNameCursor({ name: last.name, id: last.id }) : null,
  };
}

export async function getAgent(actor: Actor, id: string, db: Database = getDb()): Promise<Agent> {
  requirePermission(actor, "agents:manage");
  return findAgent(db, id);
}

export async function createAgent(
  actor: Actor,
  body: CreateAgentRequest,
  db: Database = getDb(),
): Promise<Agent> {
  requirePermission(actor, "agents:manage");
  const scopes = [...(body.scopes ?? scopesOfRole(body.role))].sort();
  checkScopes(body.role, scopes);
  try {
    return await db.transaction(async (tx) => {
      if (body.projectIds) await assertProjectsExist(tx, body.projectIds);
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into accounts (kind, name, description, role, all_projects, created_by)
        values ('agent', ${body.name}, ${body.description ?? null}, ${body.role},
          ${body.projectIds === null}, ${actor.accountId})
        returning id`);
      if (!row) throw new Error("The agent was not created.");
      await writeScopesAndProjects(tx, row.id, scopes, body.projectIds);
      await recordAudit(tx, {
        actor,
        action: "agent.created",
        entity: "account",
        entityId: row.id,
        data: { role: body.role, scopes, projectIds: body.projectIds },
      });
      return findAgent(tx, row.id);
    });
  } catch (error) {
    if (hasPostgresCode(error, UNIQUE_VIOLATION)) throw agentNameTaken();
    throw error;
  }
}

export async function updateAgent(
  actor: Actor,
  id: string,
  body: UpdateAgentRequest,
  db: Database = getDb(),
): Promise<Agent> {
  requirePermission(actor, "agents:manage");
  try {
    return await db.transaction(async (tx) => {
      const before = await findAgent(tx, id, true);
      const role = body.role ?? before.role;
      // A role change without scopes keeps the scopes the new role allows (question 3).
      const scopes = [
        ...(body.scopes ?? before.scopes.filter((scope) => scopesOfRole(role).includes(scope))),
      ].sort();
      checkScopes(role, scopes);
      const projectIds =
        body.projectIds === undefined
          ? before.projectIds
          : body.projectIds === null
            ? null
            : [...body.projectIds].sort();
      if (projectIds) await assertProjectsExist(tx, projectIds);
      const name = body.name ?? before.name;
      const description = body.description === undefined ? before.description : body.description;

      const fields: string[] = [];
      if (name !== before.name) fields.push("name");
      if (description !== before.description) fields.push("description");
      if (role !== before.role) fields.push("role");
      if (JSON.stringify(scopes) !== JSON.stringify(before.scopes)) fields.push("scopes");
      const beforeProjects = before.projectIds === null ? null : [...before.projectIds].sort();
      if (JSON.stringify(projectIds) !== JSON.stringify(beforeProjects)) {
        fields.push("projectIds");
      }

      if (fields.length > 0) {
        await tx.execute(sql`
          update accounts set name = ${name}, description = ${description}, role = ${role},
            updated_at = now()
          where id = ${id}`);
        await writeScopesAndProjects(tx, id, scopes, projectIds);
        await recordAudit(tx, {
          actor,
          action: "agent.updated",
          entity: "account",
          entityId: id,
          data: { fields },
        });
      }

      if (body.active !== undefined && body.active !== (before.status === "active")) {
        await tx.execute(sql`
          update accounts set disabled_at = ${body.active ? null : sql`now()`}, updated_at = now()
          where id = ${id}`);
        await recordAudit(tx, {
          actor,
          action: body.active ? "agent.reenabled" : "agent.disabled",
          entity: "account",
          entityId: id,
        });
      }

      return findAgent(tx, id);
    });
  } catch (error) {
    if (hasPostgresCode(error, UNIQUE_VIOLATION)) throw agentNameTaken();
    throw error;
  }
}

interface TokenRow extends Record<string, unknown> {
  id: string;
  name: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  status: ApiToken["status"];
}

const TOKEN_COLUMNS = sql`
  t.id, t.name,
  to_char(t.created_at at time zone 'utc', ${ISO_MS}) as created_at,
  to_char(t.expires_at at time zone 'utc', ${ISO_MS}) as expires_at,
  to_char(t.last_used_at at time zone 'utc', ${ISO_MS}) as last_used_at,
  to_char(t.revoked_at at time zone 'utc', ${ISO_MS}) as revoked_at,
  case when t.revoked_at is not null then 'revoked'
       when t.expires_at is not null and t.expires_at <= now() then 'expired'
       else 'active' end as status`;

function toApiToken(row: TokenRow): ApiToken {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    status: row.status,
  };
}

export async function listApiTokens(
  actor: Actor,
  agentId: string,
  db: Database = getDb(),
): Promise<ApiTokenList> {
  requirePermission(actor, "agents:manage");
  await findAgent(db, agentId);
  const rows = await db.execute<TokenRow>(sql`
    select ${TOKEN_COLUMNS} from api_tokens t
    where t.account_id = ${agentId}
    order by t.created_at desc, t.id`);
  return { items: rows.map(toApiToken), nextCursor: null };
}

export async function createApiToken(
  actor: Actor,
  agentId: string,
  body: CreateApiTokenRequest,
  db: Database = getDb(),
): Promise<CreatedApiToken> {
  requirePermission(actor, "agents:manage");
  return db.transaction(async (tx) => {
    // The lock on the agent makes the count and the insert one step under concurrency.
    const agent = await findAgent(tx, agentId, true);
    if (agent.status === "disabled") throw agentDisabled();
    const [usable] = await tx.execute<{ count: number }>(sql`
      select count(*)::int as count from api_tokens
      where account_id = ${agentId} and revoked_at is null
        and (expires_at is null or expires_at > now())`);
    if ((usable?.count ?? 0) >= MAX_USABLE_TOKENS) throw tooManyTokens();

    const { token, publicId, secretHash } = generateApiToken();
    const expiresAt =
      body.expiresInDays === null
        ? sql`null`
        : sql`now() + make_interval(days => ${body.expiresInDays}::int)`;
    const [row] = await tx.execute<TokenRow>(sql`
      with inserted as (
        insert into api_tokens (account_id, public_id, secret_hash, name, created_by, expires_at)
        values (${agentId}, ${publicId}, ${secretHash}, ${body.name}, ${actor.accountId},
          ${expiresAt})
        returning *)
      select ${TOKEN_COLUMNS} from inserted t`);
    if (!row) throw new Error("The token was not created.");
    const apiToken = toApiToken(row);
    await recordAudit(tx, {
      actor,
      action: "agent.token_created",
      entity: "api_token",
      entityId: apiToken.id,
      data: { agentId, name: apiToken.name, expiresAt: apiToken.expiresAt },
    });
    return { token, apiToken };
  });
}

export async function revokeApiToken(
  actor: Actor,
  agentId: string,
  tokenId: string,
  db: Database = getDb(),
): Promise<void> {
  requirePermission(actor, "agents:manage");
  await db.transaction(async (tx) => {
    const [row] = await tx.execute<{ revoked: boolean }>(sql`
      select revoked_at is not null as revoked from api_tokens
      where id = ${tokenId} and account_id = ${agentId}
      for update`);
    if (!row) throw notFound("The agent has no such token.");
    if (row.revoked) return;
    await tx.execute(sql`update api_tokens set revoked_at = now() where id = ${tokenId}`);
    await recordAudit(tx, {
      actor,
      action: "agent.token_revoked",
      entity: "api_token",
      entityId: tokenId,
      data: { agentId },
    });
  });
}
