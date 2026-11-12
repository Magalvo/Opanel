import { type HumanRole, humanRoleSchema, type Permission } from "@/lib/schemas/permissions";

type PermissionSet = ReadonlySet<Permission>;

const viewer: PermissionSet = new Set<Permission>(["projects:read", "tasks:read"]);

const member: PermissionSet = new Set<Permission>([
  ...viewer,
  "tasks:write",
  "comments:write",
  "labels:write",
  "tasks:delete_own",
]);

const manager: PermissionSet = new Set<Permission>([
  ...member,
  "tasks:delete_any",
  "projects:manage",
  "epics:manage",
  "sprints:manage",
  "labels:manage",
  "teams:manage",
]);

const admin: PermissionSet = new Set<Permission>([
  ...manager,
  "accounts:manage",
  "agents:manage",
  "organization:manage",
]);

/** Human roles as fixed, cumulative bundles (doc 0003 section 3). */
export const HUMAN_ROLE_PERMISSIONS: Readonly<Record<HumanRole, PermissionSet>> = {
  viewer,
  member,
  manager,
  admin,
};

/** Throws for anything that is not a human role: a bad stored value never gets a default. */
export function permissionsForRole(role: unknown): PermissionSet {
  return HUMAN_ROLE_PERMISSIONS[humanRoleSchema.parse(role)];
}
