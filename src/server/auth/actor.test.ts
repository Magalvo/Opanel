import { describe, expect, it } from "vitest";

import { ApiError } from "@/server/http/errors";

import {
  type Actor,
  agentActor,
  can,
  canAccessProject,
  canDeleteTask,
  humanActor,
  requirePermission,
  requireProjectAccess,
} from "./actor";
import { permissionsForRole } from "./roles";

describe("humanActor", () => {
  it("carries the id, the role and the permissions of the role", () => {
    const actor = humanActor({ accountId: "acc-1", role: "manager" });
    expect(actor.kind).toBe("human");
    expect(actor.accountId).toBe("acc-1");
    expect(actor.role).toBe("manager");
    expect(actor.permissions).toBe(permissionsForRole("manager"));
  });
});

describe("can", () => {
  it("is false for a viewer writing tasks and true for a member", () => {
    expect(can(humanActor({ accountId: "a", role: "viewer" }), "tasks:write")).toBe(false);
    expect(can(humanActor({ accountId: "a", role: "member" }), "tasks:write")).toBe(true);
  });

  it("is false for a manager managing accounts and true for an admin", () => {
    expect(can(humanActor({ accountId: "a", role: "manager" }), "accounts:manage")).toBe(false);
    expect(can(humanActor({ accountId: "a", role: "admin" }), "accounts:manage")).toBe(true);
  });
});

describe("requirePermission", () => {
  it("returns when the permission is held", () => {
    expect(() => {
      requirePermission(humanActor({ accountId: "a", role: "admin" }), "agents:manage");
    }).not.toThrow();
  });

  it("throws a 403 forbidden ApiError otherwise", () => {
    try {
      requirePermission(humanActor({ accountId: "a", role: "viewer" }), "tasks:write");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(403);
      expect((error as ApiError).code).toBe("forbidden");
    }
  });

  it("does not disclose the permission or the role in the detail", () => {
    try {
      requirePermission(humanActor({ accountId: "a", role: "viewer" }), "accounts:manage");
      expect.unreachable();
    } catch (error) {
      const detail = (error as ApiError).detail;
      expect(detail).not.toContain("accounts");
      expect(detail).not.toContain("manage");
      expect(detail).not.toContain("viewer");
    }
  });
});

describe("canDeleteTask", () => {
  const task = { reporterId: "reporter" };

  it("never lets a viewer delete", () => {
    expect(canDeleteTask(humanActor({ accountId: "reporter", role: "viewer" }), task)).toBe(false);
  });

  it("lets a member delete only tasks they reported", () => {
    expect(canDeleteTask(humanActor({ accountId: "reporter", role: "member" }), task)).toBe(true);
    expect(canDeleteTask(humanActor({ accountId: "other", role: "member" }), task)).toBe(false);
  });

  it("lets managers and admins delete any task", () => {
    expect(canDeleteTask(humanActor({ accountId: "other", role: "manager" }), task)).toBe(true);
    expect(canDeleteTask(humanActor({ accountId: "other", role: "admin" }), task)).toBe(true);
  });
});

describe("agentActor (WS-071)", () => {
  it("has exactly its scopes as permissions, and its project restriction", () => {
    const actor = agentActor({
      accountId: "agent-1",
      role: "qa_agent",
      scopes: ["projects:read", "tasks:read"],
      projectIds: ["p1", "p2"],
    });
    expect(actor.kind).toBe("agent");
    expect(actor.accountId).toBe("agent-1");
    expect(actor.role).toBe("qa_agent");
    expect([...actor.permissions].sort()).toEqual(["projects:read", "tasks:read"]);
    expect(actor.projectIds).toEqual(new Set(["p1", "p2"]));
    expect(can(actor, "tasks:read")).toBe(true);
    expect(can(actor, "comments:write")).toBe(false);
    expect(() => {
      requirePermission(actor, "reports:write");
    }).toThrow(ApiError);
  });

  it("keeps null as all projects, and an empty list as no project", () => {
    const all = agentActor({ accountId: "a", role: "qa_agent", scopes: [], projectIds: null });
    const none = agentActor({ accountId: "a", role: "qa_agent", scopes: [], projectIds: [] });
    expect(all.projectIds).toBeNull();
    expect(none.projectIds).toEqual(new Set());
  });

  it("refuses a scope its role lacks, a non-agent scope, and a non-agent role", () => {
    const base = { accountId: "a", projectIds: null };
    expect(() => agentActor({ ...base, role: "qa_agent", scopes: ["tasks:write"] })).toThrow();
    expect(() =>
      agentActor({ ...base, role: "worker_agent", scopes: ["agents:manage"] }),
    ).toThrow();
    expect(() => agentActor({ ...base, role: "admin", scopes: [] })).toThrow();
    expect(
      agentActor({ ...base, role: "worker_agent", scopes: ["tasks:write"] }).permissions,
    ).toEqual(new Set(["tasks:write"]));
  });
});

describe("humanActor and project restrictions (WS-071)", () => {
  it("carries no restriction", () => {
    expect(humanActor({ accountId: "a", role: "member" }).projectIds).toBeNull();
  });
});

describe("canAccessProject (WS-073)", () => {
  const agent = (projectIds: string[] | null): Actor =>
    agentActor({ accountId: "a", role: "qa_agent", scopes: [], projectIds });

  it("is true for a human, for an agent with all projects, and for a listed project", () => {
    expect(canAccessProject(humanActor({ accountId: "h", role: "viewer" }), "p1")).toBe(true);
    expect(canAccessProject(agent(null), "p1")).toBe(true);
    expect(canAccessProject(agent(["p1", "p2"]), "p2")).toBe(true);
  });

  it("is false for an unlisted project, and for an agent restricted to no project", () => {
    expect(canAccessProject(agent(["p1"]), "p2")).toBe(false);
    expect(canAccessProject(agent([]), "p1")).toBe(false);
  });
});

describe("requireProjectAccess (WS-073)", () => {
  it("returns for a reachable project", () => {
    expect(() => {
      requireProjectAccess(humanActor({ accountId: "h", role: "member" }), "p1");
    }).not.toThrow();
  });

  it("throws the forbidden ApiError, naming neither the project nor the list", () => {
    const actor = agentActor({
      accountId: "a",
      role: "qa_agent",
      scopes: [],
      projectIds: ["p1"],
    });
    try {
      requireProjectAccess(actor, "p2");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 403, code: "forbidden" });
      const { detail } = error as ApiError;
      expect(detail).not.toContain("p1");
      expect(detail).not.toContain("p2");
      expect(detail).toBe("You are not allowed to do this.");
    }
  });
});
