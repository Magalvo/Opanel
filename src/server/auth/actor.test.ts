import { describe, expect, it } from "vitest";

import { ApiError } from "@/server/http/errors";

import { can, canDeleteTask, humanActor, requirePermission } from "./actor";
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
    expect(() =>
      requirePermission(humanActor({ accountId: "a", role: "admin" }), "agents:manage"),
    ).not.toThrow();
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
