import { describe, expect, it } from "vitest";

import {
  HUMAN_ROLES,
  type HumanRole,
  type Permission,
  PERMISSIONS,
} from "@/lib/schemas/permissions";

import { HUMAN_ROLE_PERMISSIONS, permissionsForRole } from "./roles";

// The table of canonical doc 0003 section 3, written out literally on purpose.
const viewer: Permission[] = ["projects:read", "tasks:read"];
const member: Permission[] = [
  ...viewer,
  "tasks:write",
  "comments:write",
  "labels:write",
  "tasks:delete_own",
];
const manager: Permission[] = [
  ...member,
  "tasks:delete_any",
  "projects:manage",
  "epics:manage",
  "sprints:manage",
  "labels:manage",
  "teams:manage",
];
const admin: Permission[] = [...manager, "accounts:manage", "agents:manage", "organization:manage"];

const expected: Record<HumanRole, Permission[]> = { viewer, member, manager, admin };

describe("HUMAN_ROLE_PERMISSIONS", () => {
  it.each(HUMAN_ROLES)("matches doc 0003 for %s", (role) => {
    expect([...HUMAN_ROLE_PERMISSIONS[role]].sort()).toEqual([...expected[role]].sort());
  });

  it("is cumulative: viewer ⊂ member ⊂ manager ⊂ admin", () => {
    const pairs: [HumanRole, HumanRole][] = [
      ["viewer", "member"],
      ["member", "manager"],
      ["manager", "admin"],
    ];
    for (const [lowerRole, higherRole] of pairs) {
      const lower = HUMAN_ROLE_PERMISSIONS[lowerRole];
      const higher = HUMAN_ROLE_PERMISSIONS[higherRole];
      for (const permission of lower) expect(higher.has(permission)).toBe(true);
      expect(higher.size).toBeGreaterThan(lower.size);
    }
  });

  it("keeps reports:write in the catalogue but in no human role", () => {
    expect(PERMISSIONS).toContain("reports:write");
    for (const role of HUMAN_ROLES) {
      expect(HUMAN_ROLE_PERMISSIONS[role].has("reports:write")).toBe(false);
    }
  });

  it("gives admin every permission except the agent-only ones", () => {
    const agentOnly = new Set<Permission>(["reports:write"]);
    for (const permission of PERMISSIONS) {
      expect(HUMAN_ROLE_PERMISSIONS.admin.has(permission)).toBe(!agentOnly.has(permission));
    }
  });
});

describe("permissionsForRole", () => {
  it.each(HUMAN_ROLES)("returns the bundle for %s", (role) => {
    expect(permissionsForRole(role)).toBe(HUMAN_ROLE_PERMISSIONS[role]);
  });

  it("throws for an unknown role instead of defaulting", () => {
    expect(() => permissionsForRole("root")).toThrow();
    expect(() => permissionsForRole(undefined)).toThrow();
  });
});
