import { describe, expect, it } from "vitest";

import {
  AGENT_ROLES,
  AGENT_SCOPES,
  agentRoleSchema,
  agentScopeSchema,
  humanRoleSchema,
  PERMISSIONS,
  permissionSchema,
} from "./permissions";

describe("permissionSchema", () => {
  it("accepts every listed permission", () => {
    for (const permission of PERMISSIONS) {
      expect(permissionSchema.parse(permission)).toBe(permission);
    }
  });

  it("rejects unknown, empty and wrongly cased values", () => {
    for (const value of ["tasks:fly", "", "Tasks:Read", "tasks", 1, null]) {
      expect(permissionSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("humanRoleSchema", () => {
  it("accepts exactly the four human roles", () => {
    for (const role of ["admin", "manager", "member", "viewer"]) {
      expect(humanRoleSchema.parse(role)).toBe(role);
    }
  });

  it("rejects agent, owner and empty", () => {
    for (const value of ["agent", "owner", ""]) {
      expect(humanRoleSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("AGENT_SCOPES (WS-071)", () => {
  it("is exactly the five agent scopes of doc 0001 section 3", () => {
    expect([...AGENT_SCOPES].sort()).toEqual(
      ["comments:write", "projects:read", "reports:write", "tasks:read", "tasks:write"].sort(),
    );
  });

  it("holds no manage or delete permission, and only catalogued ones", () => {
    for (const scope of AGENT_SCOPES) {
      expect(scope.endsWith(":manage")).toBe(false);
      expect(scope.startsWith("tasks:delete")).toBe(false);
      expect(PERMISSIONS).toContain(scope);
    }
  });

  it("is what agentScopeSchema accepts", () => {
    for (const scope of AGENT_SCOPES) expect(agentScopeSchema.parse(scope)).toBe(scope);
    for (const value of ["agents:manage", "tasks:delete_any", "labels:write", ""]) {
      expect(agentScopeSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("agentRoleSchema (WS-071)", () => {
  it("accepts exactly the two agent roles", () => {
    expect([...AGENT_ROLES]).toEqual(["qa_agent", "worker_agent"]);
    for (const value of ["admin", "member", "agent", ""]) {
      expect(agentRoleSchema.safeParse(value).success).toBe(false);
    }
  });
});
