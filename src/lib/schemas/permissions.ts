import { z } from "zod";

/**
 * The single catalogue of permissions (canonical docs 0001 section 4 and 0003 section 3).
 * Services check these names; human roles and agent scopes are bundles of them.
 */
export const PERMISSIONS = [
  "projects:read",
  "tasks:read",
  "tasks:write",
  "comments:write",
  "reports:write",
  "labels:write",
  "tasks:delete_own",
  "tasks:delete_any",
  "projects:manage",
  "epics:manage",
  "sprints:manage",
  "labels:manage",
  "teams:manage",
  "accounts:manage",
  "agents:manage",
  "organization:manage",
] as const;

export const permissionSchema = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof permissionSchema>;

export const HUMAN_ROLES = ["viewer", "member", "manager", "admin"] as const;

export const humanRoleSchema = z.enum(HUMAN_ROLES);
export type HumanRole = z.infer<typeof humanRoleSchema>;
