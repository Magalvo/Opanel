import type { HumanRole, Permission } from "@/lib/schemas/permissions";
import { forbidden } from "@/server/http/errors";

import { permissionsForRole } from "./roles";

/**
 * Who is acting. Every service function takes one. WT-05 adds an `"agent"` member to this
 * union; code that only uses `permissions` is unaffected.
 */
export interface Actor {
  readonly kind: "human";
  readonly accountId: string;
  readonly role: HumanRole;
  readonly permissions: ReadonlySet<Permission>;
}

export function humanActor(input: { accountId: string; role: HumanRole }): Actor {
  return {
    kind: "human",
    accountId: input.accountId,
    role: input.role,
    permissions: permissionsForRole(input.role),
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
