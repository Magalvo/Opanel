import { describe, expect, it } from "vitest";

import { contracts } from "@/lib/openapi/contracts";

import {
  createTaskRequestSchema,
  moveTaskRequestSchema,
  taskListQuerySchema,
  taskParamsSchema,
  updateTaskRequestSchema,
} from "./tasks";

const UUID = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";

describe("task requests", () => {
  it("create: trimmed title 1..200, description up to 50 000, type defaulting to nothing sent", () => {
    expect(createTaskRequestSchema.parse({ title: "  Fix login  " })).toEqual({
      title: "Fix login",
    });
    expect(
      createTaskRequestSchema.parse({
        title: "T",
        description: " *md* ",
        type: "bug",
        columnId: UUID,
        assigneeTeamId: UUID,
        assigneeAccountId: UUID,
      }),
    ).toMatchObject({ description: " *md* ", type: "bug" });
    for (const body of [
      { title: "" },
      { title: "x".repeat(201) },
      { title: "T", description: "x".repeat(50_001) },
      { title: "T", type: "epic" },
      { title: "T", columnId: "abc" },
      { title: "T", assigneeTeamId: null },
      { title: "T", key: "OPA-1" },
    ]) {
      expect(
        createTaskRequestSchema.safeParse(body).success,
        JSON.stringify(body).slice(0, 60),
      ).toBe(false);
    }
  });

  it("take an epic: an id on create, an id or null on update (WS-033)", () => {
    expect(createTaskRequestSchema.parse({ title: "T", epicId: UUID }).epicId).toBe(UUID);
    expect(createTaskRequestSchema.safeParse({ title: "T", epicId: null }).success).toBe(false);
    expect(updateTaskRequestSchema.parse({ epicId: null, version: 1 })).toEqual({
      epicId: null,
      version: 1,
    });
    expect(updateTaskRequestSchema.safeParse({ epicId: "x", version: 1 }).success).toBe(false);
  });

  it("update: needs version and a field; assignees may be null to clear", () => {
    expect(
      updateTaskRequestSchema.parse({ assigneeTeamId: null, assigneeAccountId: null, version: 2 }),
    ).toEqual({ assigneeTeamId: null, assigneeAccountId: null, version: 2 });
    expect(updateTaskRequestSchema.safeParse({ title: "T", version: 1 }).success).toBe(true);
    expect(updateTaskRequestSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(updateTaskRequestSchema.safeParse({ title: "T" }).success).toBe(false);
    expect(updateTaskRequestSchema.safeParse({ columnId: UUID, version: 1 }).success).toBe(false);
  });

  it("path: the task's id or its key", () => {
    for (const taskId of [UUID, "OPA-1", "A1-123", "OPA-999999999"]) {
      expect(taskParamsSchema.safeParse({ taskId }).success, taskId).toBe(true);
    }
    for (const taskId of ["opa-1", "OPA-0", "OPA-01", "OPA", "OPA-", "OPA-1-2", "1A-1"]) {
      expect(taskParamsSchema.safeParse({ taskId }).success, taskId).toBe(false);
    }
  });

  it("list query: optional column filter and deleted flag, with pagination", () => {
    expect(taskListQuerySchema.parse({ columnId: UUID })).toEqual({ limit: 50, columnId: UUID });
    expect(taskListQuerySchema.parse({ deleted: "true" })).toEqual({ limit: 50, deleted: "true" });
    expect(taskListQuerySchema.safeParse({ columnId: "x" }).success).toBe(false);
    expect(taskListQuerySchema.safeParse({ deleted: "yes" }).success).toBe(false);
  });
});

describe("move request (WS-031)", () => {
  it("needs a column and a version, and takes at most one anchor", () => {
    expect(moveTaskRequestSchema.parse({ columnId: UUID, version: 1 })).toEqual({
      columnId: UUID,
      version: 1,
    });
    expect(
      moveTaskRequestSchema.safeParse({ columnId: UUID, afterTaskId: UUID, version: 1 }).success,
    ).toBe(true);
    expect(
      moveTaskRequestSchema.safeParse({ columnId: UUID, beforeTaskId: UUID, version: 1 }).success,
    ).toBe(true);
    for (const body of [
      { version: 1 },
      { columnId: UUID },
      { columnId: UUID, afterTaskId: UUID, beforeTaskId: UUID, version: 1 },
      { columnId: UUID, afterTaskId: "OPA-1", version: 1 },
      { columnId: UUID, afterTaskId: null, version: 1 },
      { columnId: UUID, position: "a0", version: 1 },
    ]) {
      expect(moveTaskRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});

describe("task contracts", () => {
  it("declare tasks:read and tasks:write", () => {
    const byOperation = new Map(
      contracts.map((contract) => [`${contract.method.toUpperCase()} ${contract.path}`, contract]),
    );
    const read = { kind: "permission", permission: "tasks:read" };
    const write = { kind: "permission", permission: "tasks:write" };

    expect(byOperation.get("GET /api/v1/projects/{projectId}/tasks")?.access).toEqual(read);
    expect(byOperation.get("GET /api/v1/tasks/{taskId}")?.access).toEqual(read);
    expect(byOperation.get("POST /api/v1/projects/{projectId}/tasks")?.access).toEqual(write);
    expect(byOperation.get("PATCH /api/v1/tasks/{taskId}")?.access).toEqual(write);
    expect(byOperation.get("POST /api/v1/tasks/{taskId}/move")?.access).toEqual(write);
    expect(byOperation.get("DELETE /api/v1/tasks/{taskId}")?.access).toEqual({
      kind: "permission",
      permission: "tasks:delete_own",
    });
    expect(byOperation.get("POST /api/v1/tasks/{taskId}/restore")?.access).toEqual({
      kind: "permission",
      permission: "tasks:delete_any",
    });
  });
});
