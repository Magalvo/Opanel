import { describe, expect, it } from "vitest";

import { scopesOfRole } from "@/lib/schemas/agents";
import {
  HUMAN_ROLES,
  type HumanRole,
  type Permission,
  PERMISSIONS,
} from "@/lib/schemas/permissions";

import {
  AGENT_ROLE_SCOPES,
  HUMAN_ROLE_PERMISSIONS,
  permissionsForRole,
  scopesForAgentRole,
} from "./roles";

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

describe("scopesForAgentRole (WS-071)", () => {
  it("gives qa_agent the four scopes of doc 0001, and worker_agent those and tasks:write", () => {
    const qa: Permission[] = ["projects:read", "tasks:read", "reports:write", "comments:write"];
    expect([...scopesForAgentRole("qa_agent")].sort()).toEqual([...qa].sort());
    expect([...scopesForAgentRole("worker_agent")].sort()).toEqual([...qa, "tasks:write"].sort());
    expect(AGENT_ROLE_SCOPES.qa_agent).toBe(scopesForAgentRole("qa_agent"));
  });

  it("throws for a human role or an unknown value", () => {
    expect(() => scopesForAgentRole("admin")).toThrow();
    expect(() => scopesForAgentRole("root")).toThrow();
    expect(() => scopesForAgentRole(undefined)).toThrow();
  });
});

describe("scopesOfRole mirrors AGENT_ROLE_SCOPES (WS-075)", () => {
  it.each(["qa_agent", "worker_agent"] as const)("for %s", (role) => {
    expect([...scopesOfRole(role)].sort()).toEqual([...AGENT_ROLE_SCOPES[role]].sort());
  });
});
