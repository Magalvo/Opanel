import {
  type AgentRole,
  agentRoleSchema,
  agentScopeSchema,
  type HumanRole,
  type Permission,
} from "@/lib/schemas/permissions";
import { forbidden } from "@/server/http/errors";

import { permissionsForRole, scopesForAgentRole } from "./roles";

/** A person, signed in with the session cookie. Humans are never restricted to projects. */
export interface HumanActor {
  readonly kind: "human";
  readonly accountId: string;
  readonly role: HumanRole;
  readonly permissions: ReadonlySet<Permission>;
  readonly projectIds: null;
}

/** An agent, authenticated by an API token (canonical doc 0001, WT-05). */
export interface AgentActor {
  readonly kind: "agent";
  readonly accountId: string;
  readonly role: AgentRole;
  /** Exactly the agent's stored scopes (WT-05 decision 1). */
  readonly permissions: ReadonlySet<Permission>;
  /** The projects it may reach, or `null` for all of them (WT-05 decision 7). */
  readonly projectIds: ReadonlySet<string> | null;
}

/** Who is acting. Every service function takes one. */
export type Actor = HumanActor | AgentActor;

export function humanActor(input: { accountId: string; role: HumanRole }): HumanActor {
  return {
    kind: "human",
    accountId: input.accountId,
    role: input.role,
    permissions: permissionsForRole(input.role),
    projectIds: null,
  };
}

/**
 * Builds an agent's actor from its stored role, scopes and projects. Throws for a role that
 * is not an agent role, a scope that is not an agent scope, or one the role does not
 * include: a bad stored value never becomes a permission.
 */
export function agentActor(input: {
  accountId: string;
  role: unknown;
  scopes: readonly unknown[];
  projectIds: readonly string[] | null;
}): AgentActor {
  const role = agentRoleSchema.parse(input.role);
  const allowed = scopesForAgentRole(role);
  const permissions = new Set<Permission>();
  for (const value of input.scopes) {
    const scope = agentScopeSchema.parse(value);
    if (!allowed.has(scope)) {
      throw new Error(`The scope ${scope} is not part of the agent role ${role}`);
    }
    permissions.add(scope);
  }
  return {
    kind: "agent",
    accountId: input.accountId,
    role,
    permissions,
    projectIds: input.projectIds === null ? null : new Set(input.projectIds),
  };
}

export function can(actor: Actor, permission: Permission): boolean {
  return actor.permissions.has(permission);
}

/** Throws the `forbidden` API error; its detail names neither the permission nor the role. */
export function requirePermission(actor: Actor, permission: Permission): void {
  if (!can(actor, permission)) throw forbidden();
}

/** Members delete only tasks they reported; Managers and Admins any (doc 0003 section 3). */
export function canDeleteTask(actor: Actor, task: { reporterId: string }): boolean {
  if (can(actor, "tasks:delete_any")) return true;
  return can(actor, "tasks:delete_own") && task.reporterId === actor.accountId;
}
